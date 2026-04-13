import { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  Plus, 
  X, 
  ChefHat, 
  Star, 
  Filter, 
  Languages, 
  RotateCcw, 
  Sparkles,
  Search,
  Quote,
  AlertTriangle,
  ShieldCheck,
  Moon,
  Sun,
  Copy,
  Check,
  Globe,
  UtensilsCrossed,
  ExternalLink,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { cn } from '@/src/lib/utils';
import { 
  generateRecipe, 
  suggestNewDishes, 
  fetchGlobalTrends,
  fetchRecipeForTrend,
  checkIngredientSpelling,
  type RecipeResponse, 
  type GlobalTrend
} from '@/src/services/gemini';

const DIETARY_OPTIONS = ['Vegan', 'Vegetarian', 'Gluten-Free', 'Keto', 'Dairy-Free', 'Nut-Free'];
const CUISINES = ['Any', 'Indian', 'Italian', 'Chinese', 'Japanese', 'Mexican', 'French', 'Thai', 'Mediterranean', 'American'];
const CONTINENTS = ['Global', 'Asia', 'Europe', 'Africa', 'North America', 'South America', 'Oceania'];
const LANGUAGES = [
  { code: 'English', name: 'English' },
  { code: 'Hindi', name: 'हिन्दी' },
  { code: 'Tamil', name: 'தமிழ்' },
  { code: 'Telugu', name: 'తెలుగు' },
  { code: 'Spanish', name: 'Español' },
  { code: 'French', name: 'Français' }
];

type View = 'generator' | 'trends';

export default function App() {
  const [activeView, setActiveView] = useState<View>('generator');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [inputIngredient, setInputIngredient] = useState('');
  const [dietary, setDietary] = useState<string[]>([]);
  const [cuisine, setCuisine] = useState('Any');
  const [interests, setInterests] = useState<string[]>([]);
  const [language, setLanguage] = useState('English');
  const [recipe, setRecipe] = useState<RecipeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [dailySuggestion, setDailySuggestion] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [copied, setCopied] = useState(false);
  const [trends, setTrends] = useState<GlobalTrend[]>([]);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [searchRegion, setSearchRegion] = useState('Global');
  const [expandedTrend, setExpandedTrend] = useState<number | null>(null);
  const [expandedStates, setExpandedStates] = useState<number | null>(null);
  const [trendRecipes, setTrendRecipes] = useState<Record<number, { ingredients: string[], instructions: string[] }>>({});
  const [loadingRecipe, setLoadingRecipe] = useState<number | null>(null);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Sync theme with document class
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const suggestions = [
      "Spicy Avocado Toast",
      "Homemade Ramen",
      "Mediterranean Salad",
      "Lemon Garlic Pasta",
      "Black Bean Tacos"
    ];
    setDailySuggestion(suggestions[Math.floor(Math.random() * suggestions.length)]);

    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        addIngredient(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  useEffect(() => {
    if (activeView === 'trends' && trends.length === 0) {
      loadTrends(searchRegion);
    }
  }, [activeView]);

  const loadTrends = async (region: string) => {
    setLoadingTrends(true);
    setExpandedTrend(null);
    setExpandedStates(null);
    try {
      const data = await fetchGlobalTrends(region);
      const filteredData = data.filter(t => t.imageUrl && t.imageUrl.startsWith('http'));
      setTrends(filteredData);
    } catch (error: any) {
      console.error(error);
      alert("Failed to load trends: " + (error.message || "Quota Exhausted or AI Service Down."));
    } finally {
      setLoadingTrends(false);
    }
  };

  const handleTrendClick = async (index: number, trend: GlobalTrend) => {
    if (expandedTrend === index) {
      setExpandedTrend(null);
      return;
    }

    setExpandedTrend(index);

    if (!trendRecipes[index]) {
      setLoadingRecipe(index);
      try {
        const recipeData = await fetchRecipeForTrend(trend.topDish, trend.country);
        setTrendRecipes(prev => ({ ...prev, [index]: recipeData }));
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingRecipe(null);
      }
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const addIngredient = (name: string) => {
    // Basic sanitization: remove any HTML tags
    const sanitized = name.replace(/<[^>]*>?/gm, '').trim().toLowerCase();
    if (sanitized && !ingredients.includes(sanitized)) {
      setIngredients(prev => [...prev, sanitized]);
      
      // Background spell check
      checkIngredientSpelling(sanitized).then((corrected) => {
        if (corrected && corrected !== sanitized) {
          setIngredients(current => current.map(i => i === sanitized ? corrected : i));
        }
      });
    }
    setInputIngredient('');
  };

  const removeIngredient = (name: string) => {
    setIngredients(ingredients.filter(i => i !== name));
  };

  const handleGenerate = async () => {
    if (ingredients.length === 0) return;
    setLoading(true);
    setRecipe(null); // Clear previous if any
    try {
      const res = await generateRecipe(ingredients, dietary, interests, language, cuisine);
      setRecipe(res);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#2d2d2d', '#fdfaf6', '#d1d1d1']
      });
      
      const sug = await suggestNewDishes(res.title, ingredients);
      setSuggestions(sug);
    } catch (error: any) {
      console.error(error);
      alert("Failed to generate recipe: " + (error.message || "Quota Exhausted or AI Service Down. Please wait."));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setIngredients([]);
    setRecipe(null);
    setSuggestions([]);
  };

  const copyToClipboard = () => {
    if (!recipe) return;
    const text = `
Recipe: ${recipe.title}

Ingredients:
${recipe.ingredients.map(i => `- ${i}`).join('\n')}

Instructions:
${recipe.instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Chef's Wisdom: "${recipe.chefQuote}"
    `.trim();
    
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto">
      {/* Top Navigation & Theme */}
      <div className="flex justify-between items-center mb-8">
        <nav className="flex gap-2">
          <button 
            onClick={() => setActiveView('generator')}
            className={cn(
              "sketch-button flex items-center gap-2 text-sm",
              activeView === 'generator' ? "bg-ink text-bg" : "bg-card text-ink"
            )}
          >
            <UtensilsCrossed className="w-4 h-4" /> Generator
          </button>
          <button 
            onClick={() => setActiveView('trends')}
            className={cn(
              "sketch-button flex items-center gap-2 text-sm",
              activeView === 'trends' ? "bg-ink text-bg" : "bg-card text-ink"
            )}
          >
            <Globe className="w-4 h-4" /> Global Trends
          </button>
        </nav>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="sketch-button bg-card hover:bg-bg p-2"
            title="Toggle Theme"
          >
            {theme === 'light' ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {activeView === 'generator' ? (
        <>
          {/* Header */}
          <header className="text-center mb-12">
        <motion.h1 
          initial={{ rotate: -2, scale: 0.9 }}
          animate={{ rotate: 0, scale: 1 }}
          className="font-sketch text-6xl md:text-8xl mb-2 relative inline-block"
        >
          Reciper
          <motion.div 
            className="absolute -bottom-2 left-0 w-full h-1 bg-ink/20 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            transition={{ delay: 0.5 }}
          />
        </motion.h1>
        
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 inline-block sketch-border px-4 py-1 bg-blue-50 text-blue-800 font-hand"
        >
          Daily Inspiration: <button onClick={() => setInputIngredient(dailySuggestion)} className="underline font-bold">{dailySuggestion}</button>
        </motion.div>

        <div className="mt-4 flex items-center justify-center gap-2 text-green-700 font-hand text-sm">
          <ShieldCheck className="w-4 h-4" /> Safety First: All recipes are cross-checked for culinary safety.
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8">
        {/* Input Section */}
        <section className="sketch-card space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-sketch text-2xl flex items-center gap-2">
              <Search className="w-6 h-6" /> What's in your fridge?
            </h2>
            <div className="flex items-center gap-2">
              <Languages className="w-5 h-5 text-ink/40" />
              <select 
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="font-hand bg-transparent border-none focus:ring-0 cursor-pointer"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <input 
                type="text"
                value={inputIngredient}
                onChange={(e) => setInputIngredient(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addIngredient(inputIngredient)}
                placeholder="Type an ingredient..."
                className="sketch-input w-full font-hand text-lg pr-12"
              />
              <button 
                onClick={toggleListening}
                className={cn(
                  "absolute right-3 top-1/2 -translate-y-1/2 transition-colors",
                  isListening ? "text-red-500 animate-pulse" : "text-ink/40 hover:text-ink"
                )}
              >
                <Mic className="w-5 h-5" />
              </button>
            </div>
            <button 
              onClick={() => addIngredient(inputIngredient)}
              className="sketch-button bg-ink text-bg flex items-center gap-2"
            >
              <Plus className="w-5 h-5" /> Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2 min-h-[40px]">
            <AnimatePresence>
              {ingredients.map(ing => (
                <motion.span
                  key={ing}
                  initial={{ scale: 0, rotate: -5 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                  className="sketch-border px-3 py-1 bg-yellow-50 dark:bg-yellow-900/20 font-hand text-lg flex items-center gap-2"
                >
                  {ing}
                  <button onClick={() => removeIngredient(ing)} className="hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
            {ingredients.length === 0 && (
              <p className="text-ink/40 font-hand italic">No ingredients added yet...</p>
            )}
          </div>

          {ingredients.length === 1 && (
            <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 sketch-border border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300 font-hand">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>Just one ingredient? We'll try to find a proper dish, but adding more items usually leads to better recipes!</p>
            </div>
          )}

          {/* Cuisine & Filters */}
          <div className="space-y-6 pt-4 border-t border-dashed border-ink/20">
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-sketch text-lg">
                <UtensilsCrossed className="w-5 h-5" /> Select Cuisine
              </div>
              <div className="flex flex-wrap gap-2">
                {CUISINES.map(c => (
                  <button
                    key={c}
                    onClick={() => setCuisine(c)}
                    className={cn(
                      "sketch-border px-3 py-1 font-hand transition-colors",
                      cuisine === c ? "bg-blue-100 dark:bg-blue-900/40 border-blue-800 dark:border-blue-700 text-blue-800 dark:text-blue-300" : "bg-card hover:bg-bg"
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 font-sketch text-lg">
                <Filter className="w-5 h-5" /> Dietary Restrictions
              </div>
              <div className="flex flex-wrap gap-2">
                {DIETARY_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    onClick={() => setDietary(prev => prev.includes(opt) ? prev.filter(p => p !== opt) : [...prev, opt])}
                    className={cn(
                      "sketch-border px-3 py-1 font-hand transition-colors",
                      dietary.includes(opt) ? "bg-green-100 dark:bg-green-900/20 border-green-800 dark:border-green-700 text-green-800 dark:text-green-300" : "bg-card hover:bg-bg"
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-6">
            <button 
              onClick={handleGenerate}
              disabled={loading || ingredients.length === 0}
              className={cn(
                "sketch-button flex-1 py-4 text-2xl flex items-center justify-center gap-3",
                loading ? "opacity-50 cursor-not-allowed" : "bg-orange-400 hover:bg-orange-500 text-bg"
              )}
            >
              {loading ? (
                <RotateCcw className="w-8 h-8 animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-8 h-8" />
                  Cook Something Up!
                </>
              )}
            </button>
            <button 
              onClick={reset}
              className="sketch-button bg-card hover:bg-bg px-6"
              title="Reset"
            >
              <RotateCcw className="w-6 h-6" />
            </button>
          </div>
        </section>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {recipe && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Safety Warnings Banner */}
              {recipe.safetyWarnings.length > 0 && (
                <div className="sketch-card bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300">
                  <h3 className="font-sketch text-xl flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-6 h-6" /> Safety & Allergen Alerts
                  </h3>
                  <ul className="list-disc list-inside font-hand text-lg">
                    {recipe.safetyWarnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="sketch-card relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                  <ChefHat className="w-32 h-32 rotate-12" />
                </div>

                <div className="flex justify-between items-center mb-6 border-b-2 border-ink pb-4">
                  <h2 className="font-sketch text-4xl md:text-5xl">
                    {recipe.title}
                  </h2>
                  <button 
                    onClick={copyToClipboard}
                    className="sketch-button flex items-center gap-2 bg-card hover:bg-bg text-sm py-1"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="font-sketch text-2xl flex items-center gap-2">
                      <Plus className="w-5 h-5" /> Ingredients
                    </h3>
                    <ul className="space-y-2">
                      {recipe.ingredients.map((item, i) => (
                        <li key={i} className="font-hand text-xl flex items-start gap-2">
                          <span className="mt-1.5 w-2 h-2 rounded-full bg-ink shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-sketch text-2xl flex items-center gap-2">
                      <RotateCcw className="w-5 h-5" /> Instructions
                    </h3>
                    <ol className="space-y-4">
                      {recipe.instructions.map((step, i) => (
                        <li key={i} className="font-hand text-xl flex gap-3">
                          <span className="font-sketch text-2xl opacity-30 shrink-0">{i + 1}.</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 sketch-border border-blue-200 dark:border-blue-800">
                  <p className="font-hand text-lg italic text-blue-800 dark:text-blue-300">
                    <strong>Note:</strong> {recipe.dietaryNotes}
                  </p>
                </div>
              </div>

              {/* Chef Wisdom */}
              <motion.div 
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="sketch-card bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
              >
                <div className="flex gap-4">
                  <Quote className="w-12 h-12 text-yellow-600 dark:text-yellow-400 shrink-0" />
                  <div className="space-y-2">
                    <h3 className="font-sketch text-xl text-yellow-800 dark:text-yellow-300">Chef's Wisdom</h3>
                    <p className="font-hand text-2xl italic">"{recipe.chefQuote}"</p>
                  </div>
                </div>
              </motion.div>

              {/* Community Buzz */}
              <div className="grid md:grid-cols-3 gap-4">
                {recipe.communityBuzz.map((buzz, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.4 + i * 0.1 }}
                    className="sketch-card flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex gap-1 mb-2">
                        {[...Array(5)].map((_, star) => (
                          <Star 
                            key={star} 
                            className={cn(
                              "w-4 h-4",
                              star < buzz.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200"
                            )} 
                          />
                        ))}
                      </div>
                      <p className="font-hand text-lg leading-tight mb-4">"{buzz.review}"</p>
                    </div>
                    {buzz.sourceUrl && (
                      <a 
                        href={buzz.sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="font-sketch text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        Read Full Review <Sparkles className="w-3 h-3" />
                      </a>
                    )}
                  </motion.div>
                ))}
              </div>

              {/* Social Links & Blogs */}
              <div className="sketch-card">
                <h3 className="font-sketch text-2xl mb-4 flex items-center gap-2">
                  <Languages className="w-6 h-6 text-blue-600 dark:text-blue-400" /> Real Social Buzz & Blogs
                </h3>
                <div className="space-y-3">
                  {recipe.socialLinks.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 sketch-border hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="font-sketch text-xs uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1 block">
                            {link.platform}
                          </span>
                          <p className="font-hand text-xl group-hover:underline">{link.title}</p>
                        </div>
                        <Sparkles className="w-5 h-5 text-blue-300 dark:text-blue-700 group-hover:text-blue-500" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>

              {/* Follow-up Suggestions */}
              {suggestions.length > 0 && (
                <div className="sketch-card bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
                  <h3 className="font-sketch text-2xl mb-4 flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" /> Want to try something else?
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {suggestions.map((sug, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setInterests([sug]);
                          handleGenerate();
                        }}
                        className="sketch-button bg-card hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-700"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </>
  ) : (
    <motion.section
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8"
    >
      <header className="text-center mb-12">
        <h2 className="font-sketch text-5xl md:text-6xl mb-4">Global Food Trends</h2>
        <p className="font-hand text-xl text-ink/60">Real-time authentic dishes trending across the globe</p>
        
        <div className="mt-8 space-y-4">
          <div className="flex flex-wrap justify-center gap-2">
            {CONTINENTS.map(continent => (
              <button
                key={continent}
                onClick={() => {
                  setSearchRegion(continent);
                  loadTrends(continent);
                }}
                className={cn(
                  "sketch-button text-sm px-4 py-1",
                  searchRegion === continent ? "bg-blue-600 text-bg" : "bg-card"
                )}
              >
                {continent}
              </button>
            ))}
          </div>
          
          <div className="max-w-md mx-auto relative group">
            <input 
              type="text"
              value={searchRegion === 'Global' || CONTINENTS.includes(searchRegion) ? '' : searchRegion}
              placeholder="Search by country (e.g. Japan, Brazil)..."
              className="sketch-input w-full font-hand text-lg pr-20"
              onChange={(e) => setSearchRegion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  loadTrends(searchRegion);
                }
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchRegion !== 'Global' && !CONTINENTS.includes(searchRegion) && (
                <button 
                  onClick={() => {
                    setSearchRegion('Global');
                    loadTrends('Global');
                  }}
                  className="p-1 hover:text-red-500 transition-colors"
                  title="Clear Search"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <button 
                onClick={() => loadTrends(searchRegion)}
                className="p-1 hover:text-blue-500 transition-colors"
              >
                <Search className="text-ink/40 w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-blue-700 dark:text-blue-400 font-hand text-sm">
          <Info className="w-4 h-4" /> Data-backed by real user reviews and social buzz.
        </div>
      </header>

      {loadingTrends ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <RotateCcw className="w-12 h-12 animate-spin text-ink/20" />
          <p className="font-hand text-xl animate-pulse">Scanning the globe for authentic flavors...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {trends.map((trend, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="sketch-card overflow-hidden flex flex-col"
            >
              <div className="grid md:grid-cols-2 gap-8">
                <div 
                  className="relative h-64 md:h-full min-h-[300px] -mx-6 -mt-6 md:m-0 overflow-hidden border-b-2 md:border-b-0 md:border-r-2 border-ink cursor-pointer group"
                  onClick={() => handleTrendClick(i, trend)}
                >
                  <img 
                    src={trend.imageUrl} 
                    alt={trend.topDish}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-ink/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <p className="text-bg font-sketch text-2xl">Click for Recipe</p>
                  </div>
                </div>

                <div className="flex flex-col py-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-4 h-4 text-blue-600" />
                    <span className="font-sketch text-sm uppercase tracking-widest text-blue-600">{trend.country}</span>
                  </div>
                  <h3 className="font-sketch text-4xl mb-3">{trend.topDish}</h3>
                  <p className="font-hand text-xl text-ink/80 mb-6">{trend.description}</p>
                  
                  <div className="space-y-4 mb-8">
                    <h4 className="font-sketch text-lg flex items-center gap-2">
                      <Quote className="w-4 h-4" /> Real People Reviews
                    </h4>
                    {trend.reviews.map((rev, ri) => (
                      <div key={ri} className="p-3 bg-card/50 sketch-border border-dashed">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-hand font-bold text-sm">{rev.user}</span>
                          <div className="flex gap-0.5">
                            {[...Array(5)].map((_, s) => (
                              <Star key={s} className={cn("w-3 h-3", s < rev.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300")} />
                            ))}
                          </div>
                        </div>
                        <p className="font-hand text-sm italic">"{rev.text}"</p>
                      </div>
                    ))}
                  </div>

                  <a 
                    href={trend.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sketch-button bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 flex items-center justify-center gap-2 mt-auto"
                  >
                    View Authentic Source <ExternalLink className="w-4 h-4" />
                  </a>

                  {trend.states && trend.states.length > 0 && (
                    <button 
                      onClick={() => setExpandedStates(expandedStates === i ? null : i)}
                      className="sketch-button mt-4 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 flex items-center justify-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" /> 
                      {expandedStates === i ? 'Hide Regional Specialties' : `Explore ${trend.country} State-wise Dishes`}
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {expandedStates === i && trend.states && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t-2 border-ink mt-6 pt-6"
                  >
                    <h4 className="font-sketch text-3xl mb-6 text-center">Regional Specialties from {trend.country}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {trend.states.map((state, si) => (
                        <motion.div 
                          key={si}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: si * 0.05 }}
                          className="sketch-card p-0 overflow-hidden flex flex-col"
                        >
                          <div className="h-40 overflow-hidden border-b-2 border-ink">
                            <img 
                              src={state.imageUrl} 
                              alt={state.dish}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="p-4 flex-1">
                            <span className="font-sketch text-xs uppercase tracking-widest text-ink/40">{state.stateName}</span>
                            <h5 className="font-sketch text-xl mb-2">{state.dish}</h5>
                            <p className="font-hand text-sm text-ink/70">{state.description}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {expandedTrend === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t-2 border-ink mt-6 pt-6"
                  >
                    {loadingRecipe === i ? (
                      <div className="flex flex-col items-center py-8 gap-2">
                        <RotateCcw className="w-8 h-8 animate-spin text-ink/20" />
                        <p className="font-hand text-lg">Uncovering the secret recipe...</p>
                      </div>
                    ) : trendRecipes[i] ? (
                      <div className="grid md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <h4 className="font-sketch text-2xl flex items-center gap-2">
                            <Plus className="w-5 h-5" /> Authentic Ingredients
                          </h4>
                          <ul className="space-y-2">
                            {trendRecipes[i].ingredients.map((ing, idx) => (
                              <li key={idx} className="font-hand text-lg flex items-start gap-2">
                                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ink shrink-0" />
                                {ing}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-4">
                          <h4 className="font-sketch text-2xl flex items-center gap-2">
                            <RotateCcw className="w-5 h-5" /> Cooking Methods
                          </h4>
                          <ol className="space-y-3">
                            {trendRecipes[i].instructions.map((step, idx) => (
                              <li key={idx} className="font-hand text-lg flex gap-3">
                                <span className="font-sketch text-xl opacity-30 shrink-0">{idx + 1}.</span>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
      
      <div className="text-center pt-8">
        <button 
          onClick={() => loadTrends(searchRegion)}
          className="sketch-button bg-card hover:bg-bg flex items-center gap-2 mx-auto"
        >
          <RotateCcw className="w-5 h-5" /> Refresh Trends
        </button>
      </div>
    </motion.section>
  )}

      <footer className="mt-20 text-center font-hand text-ink/50 pb-8">
        <p>made as a hobby project with ai by sravan shaji</p>
        <p className="text-xs mt-2">Disclaimer: Always verify ingredients for your specific allergies. AI suggestions are for inspiration.</p>
      </footer>
    </div>
  );
}
