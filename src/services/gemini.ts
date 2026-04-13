const API_BASE = '/api';

export interface RecipeResponse {
  title: string;
  ingredients: string[];
  instructions: string[];
  chefQuote: string;
  communityBuzz: {
    review: string;
    rating: number;
    sourceUrl?: string;
  }[];
  dietaryNotes: string;
  safetyWarnings: string[];
  socialLinks: {
    platform: string;
    url: string;
    title: string;
  }[];
}

export interface GlobalTrend {
  country: string;
  topDish: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  reviews: {
    user: string;
    text: string;
    rating: number;
  }[];
  states?: {
    stateName: string;
    dish: string;
    description: string;
    imageUrl: string;
  }[];
}

async function request(endpoint: string, body: any) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'API request failed');
  }
  return response.json();
}

export async function fetchGlobalTrends(region: string = "Global"): Promise<GlobalTrend[]> {
  return request('/trends', { region });
}

export async function fetchRecipeForTrend(dish: string, country: string): Promise<{ ingredients: string[], instructions: string[] }> {
    const res = await request('/recipe', { 
        ingredients: [dish], 
        dietaryRestrictions: [], 
        interests: [`Authentic ${country} cuisine`],
        cuisine: country
    });
    return { ingredients: res.ingredients, instructions: res.instructions };
}

export async function generateRecipe(
  ingredients: string[],
  dietaryRestrictions: string[],
  interests: string[],
  language: string = "English",
  cuisine: string = "Any"
): Promise<RecipeResponse> {
  return request('/recipe', {
    ingredients,
    dietaryRestrictions,
    interests,
    language,
    cuisine
  });
}

export async function suggestNewDishes(
  previousRecipe: string,
  ingredients: string[]
): Promise<string[]> {
  return request('/suggestions', {
    ingredients,
    interests: [previousRecipe]
  });
}

export async function checkIngredientSpelling(ingredient: string): Promise<string> {
  try {
    const res = await request('/spellcheck', { ingredient });
    return res.corrected || ingredient;
  } catch (e) {
    return ingredient;
  }
}
