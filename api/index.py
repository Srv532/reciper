import os
import json
import logging
import hashlib
import asyncio
import time
from functools import wraps
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Any
from google import genai
from google.genai import types
from dotenv import load_dotenv
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("reciper")

app = FastAPI(title="Reciper API", docs_url=None, redoc_url=None)

# ── CORS ─────────────────────────────────────────────────────────────
allowed_origins = os.getenv("APP_URL", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

# ── Simple in-process rate limiter ───────────────────────────────────
_request_counts: dict[str, list[float]] = {}

def rate_limit(max_calls: int = 10, window_seconds: int = 60):
    """Decorator: max_calls per IP per window_seconds."""
    def decorator(func):
        @wraps(func)
        async def wrapper(request: Request, *args, **kwargs):
            ip = request.client.host if request.client else "unknown"
            now = time.time()
            timestamps = _request_counts.get(ip, [])
            # Keep only timestamps within the window
            timestamps = [t for t in timestamps if now - t < window_seconds]
            if len(timestamps) >= max_calls:
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many requests. Max {max_calls} per {window_seconds}s."
                )
            timestamps.append(now)
            _request_counts[ip] = timestamps
            return await func(request, *args, **kwargs)
        return wrapper
    return decorator

# ── Simple TTL Response Cache ─────────────────────────────────────────
_cache: dict[str, tuple[Any, float]] = {}
CACHE_TTL_SECONDS = {
    "trends": 300,      # 5 min — trends don't change that fast
    "recipe": 600,      # 10 min — same ingredients = same recipe
    "suggestions": 120, # 2 min
}

def _cache_key(namespace: str, data: dict) -> str:
    payload = json.dumps(data, sort_keys=True)
    return f"{namespace}:{hashlib.md5(payload.encode()).hexdigest()}"

def cache_get(key: str) -> Any | None:
    if key in _cache:
        value, expires_at = _cache[key]
        if time.time() < expires_at:
            logger.info(f"CACHE HIT: {key[:40]}")
            return value
        del _cache[key]
    return None

def cache_set(key: str, value: Any, ttl: int):
    _cache[key] = (value, time.time() + ttl)

# ── AI Client ─────────────────────────────────────────────────────────
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError("GEMINI_API_KEY environment variable is required")
client = genai.Client(api_key=api_key)

# ── Model Hierarchy ───────────────────────────────────────────────────
PRIMARY_MODEL = "gemma-4-31b-it"
FALLBACK_MODELS = ["gemini-3-flash-preview", "gemini-2.5-flash"]
AI_TIMEOUT_SECONDS = 55  # Stay under Vercel's 60s function limit


# ── Pydantic Models ───────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    ingredients: List[str]
    dietaryRestrictions: List[str] = []
    interests: List[str] = []
    language: str = "English"
    cuisine: str = "Any"

class TrendRequest(BaseModel):
    region: str = "Global"


# ── Sync AI call wrapped for thread safety ────────────────────────────
# The google-genai SDK is synchronous. Running it directly in an async
# endpoint blocks the event loop. asyncio.to_thread() fixes this.

def _sync_generate(model_id: str, prompt: str, schema: dict, use_search: bool) -> str:
    """Synchronous AI call — always run via asyncio.to_thread()."""
    config_params = {
        "response_mime_type": "application/json",
        "response_schema": schema,
    }
    # Gemma 4 doesn't support thinking_config on all endpoints — skip it to avoid 400 errors
    if model_id in FALLBACK_MODELS:
        if use_search:
            config_params["tools"] = [types.Tool(google_search=types.GoogleSearch())]
    else:
        # Gemma 4 — enable thinking for quality
        config_params["thinking_config"] = types.ThinkingConfig(include_thoughts=True)

    response = client.models.generate_content(
        model=model_id,
        contents=prompt,
        config=types.GenerateContentConfig(**config_params),
    )
    return response.text


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=2, max=8),
    retry=retry_if_exception_type(Exception),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
async def _call_model(model_id: str, prompt: str, schema: dict, use_search: bool) -> Any:
    """Async wrapper with tenacity retry (2 attempts, exponential backoff)."""
    logger.info(f"CALLING: {model_id} (search={use_search})")
    raw = await asyncio.wait_for(
        asyncio.to_thread(_sync_generate, model_id, prompt, schema, use_search),
        timeout=AI_TIMEOUT_SECONDS,
    )
    result = json.loads(raw)
    logger.info(f"SUCCESS: {model_id}")
    return result


async def generate(prompt: str, schema: dict, use_search_on_fallback: bool = True) -> Any:
    """
    Gemma 4 → Gemini fallbacks. Runs in thread pool to avoid blocking.
    """
    # 1. Try Gemma 4 (primary, no google_search)
    try:
        return await _call_model(PRIMARY_MODEL, prompt, schema, use_search=False)
    except Exception as e:
        logger.warning(f"PRIMARY ({PRIMARY_MODEL}) failed: {str(e)[:100]}")

    # 2. Try Gemini fallbacks (with optional live search)
    for model_id in FALLBACK_MODELS:
        try:
            return await _call_model(model_id, prompt, schema, use_search=use_search_on_fallback)
        except Exception as e:
            logger.warning(f"FALLBACK ({model_id}) failed: {str(e)[:100]}")
            continue

    raise HTTPException(
        status_code=503,
        detail="AI service temporarily unavailable. Please try again in a moment."
    )


# ── Routes ────────────────────────────────────────────────────────────
@app.post("/api/trends")
@rate_limit(max_calls=15, window_seconds=60)
async def get_trends(request: Request, req: TrendRequest):
    cache_key = _cache_key("trends", {"region": req.region})
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    is_specific = req.region not in [
        "Global", "Asia", "Europe", "Africa",
        "North America", "South America", "Oceania"
    ]

    region_instruction = (
        f"Find the TOP trending viral dish for {req.region} as the main entry. "
        f"Include a 'states' array with 6-8 famous dishes from different regions within {req.region}."
        if is_specific else
        f"Find 5 COMPLETELY DIFFERENT countries from {req.region} that each "
        f"have a viral or trending food dish right now. One dish per country."
    )

    prompt = f"""You are a world-class food trend analyst.

{region_instruction}

For EACH dish, provide:
- country: country name
- topDish: dish name
- description: vivid 2-sentence description
- imageUrl: a valid public image URL (use Wikimedia Commons or well-known food sites)
- sourceUrl: a credible source URL
- reviews: 2-3 realistic user reviews with "user" (name), "text", and "rating" (1-5)

If searching within a specific country, also include:
- states: array with "stateName", "dish", "description", "imageUrl"

Return ONLY valid JSON. No markdown fences."""

    schema = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "country": {"type": "STRING"},
                "topDish": {"type": "STRING"},
                "description": {"type": "STRING"},
                "imageUrl": {"type": "STRING"},
                "sourceUrl": {"type": "STRING"},
                "reviews": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "user": {"type": "STRING"},
                            "text": {"type": "STRING"},
                            "rating": {"type": "NUMBER"},
                        },
                    },
                },
                "states": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "stateName": {"type": "STRING"},
                            "dish": {"type": "STRING"},
                            "description": {"type": "STRING"},
                            "imageUrl": {"type": "STRING"},
                        },
                    },
                },
            },
            "required": ["country", "topDish", "description", "imageUrl", "sourceUrl", "reviews"],
        },
    }

    result = await generate(prompt, schema, use_search_on_fallback=True)
    cache_set(cache_key, result, CACHE_TTL_SECONDS["trends"])
    return result


@app.post("/api/recipe")
@rate_limit(max_calls=10, window_seconds=60)
async def create_recipe(request: Request, req: GenerateRequest):
    cache_key = _cache_key("recipe", {
        "ingredients": sorted(req.ingredients),
        "dietary": sorted(req.dietaryRestrictions),
        "cuisine": req.cuisine,
        "language": req.language,
    })
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    constraints = ", ".join(req.dietaryRestrictions) or "None"
    interests   = ", ".join(req.interests) or "None"

    prompt = f"""You are a professional chef and food safety expert.

Generate a {req.cuisine} recipe using: {", ".join(req.ingredients)}.
Dietary restrictions: {constraints}.
Special interests: {interests}.
Language: {req.language}.

SAFETY RULES:
- Cross-check all ingredients for safety. Flag toxic combinations.
- Explicitly check for common allergens (Lactose, Nuts, Gluten, Shellfish, Eggs).
- If only one ingredient is provided, suggest a proper dish — not just "eat it raw".

Return JSON:
- title: authentic dish name
- ingredients: list with measurements
- instructions: step-by-step guide
- chefQuote: short culinary wisdom
- communityBuzz: 3 reviews, each with "review" (text), "rating" (1-5 number), "sourceUrl"
- dietaryNotes: suitability summary
- safetyWarnings: specific allergen or safety alerts
- socialLinks: 3 inspiration links, each with "platform", "url", "title"

Return ONLY valid JSON. No markdown fences."""

    schema = {
        "type": "OBJECT",
        "properties": {
            "title": {"type": "STRING"},
            "ingredients": {"type": "ARRAY", "items": {"type": "STRING"}},
            "instructions": {"type": "ARRAY", "items": {"type": "STRING"}},
            "chefQuote": {"type": "STRING"},
            "communityBuzz": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "review": {"type": "STRING"},
                        "rating": {"type": "NUMBER"},
                        "sourceUrl": {"type": "STRING"},
                    },
                },
            },
            "dietaryNotes": {"type": "STRING"},
            "safetyWarnings": {"type": "ARRAY", "items": {"type": "STRING"}},
            "socialLinks": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "platform": {"type": "STRING"},
                        "url": {"type": "STRING"},
                        "title": {"type": "STRING"},
                    },
                },
            },
        },
        "required": [
            "title", "ingredients", "instructions", "chefQuote",
            "communityBuzz", "dietaryNotes", "safetyWarnings", "socialLinks"
        ],
    }

    result = await generate(prompt, schema, use_search_on_fallback=True)
    cache_set(cache_key, result, CACHE_TTL_SECONDS["recipe"])
    return result


@app.post("/api/suggestions")
@rate_limit(max_calls=20, window_seconds=60)
async def get_suggestions(request: Request, req: GenerateRequest):
    cache_key = _cache_key("suggestions", {"ingredients": sorted(req.ingredients)})
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    prompt = (
        f"Suggest 3 creative culinary dishes for these ingredients: "
        f"{', '.join(req.ingredients)}. "
        f"Return a JSON array of exactly 3 dish name strings. No markdown."
    )
    schema = {"type": "ARRAY", "items": {"type": "STRING"}}

    result = await generate(prompt, schema, use_search_on_fallback=False)
    cache_set(cache_key, result, CACHE_TTL_SECONDS["suggestions"])
    return result


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "primary_model": PRIMARY_MODEL,
        "fallback_models": FALLBACK_MODELS,
        "cache_entries": len(_cache),
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.url.path}: {type(exc).__name__}")
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again."}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        workers=1,
        loop="asyncio",
    )
