import type { GeneratedCategory, PhotoAnalysis } from '@/types/chat';
import { getURLs } from '@/config/urls';

function buildGenerationPrompt(
  photoAnalysis: PhotoAnalysis,
  intent: string,
  options?: {
    mode?: 'refresh' | 'expand';
    currentLook?: string;
    currentCategories?: GeneratedCategory[];
  }
): string {
  const mode = options?.mode || 'refresh';
  const currentLook = options?.currentLook;
  const currentCategories = options?.currentCategories;

  const baseRules = `Rules:
- You MUST generate at least 4 categories with at least 5 transformation options each.
- Write prompts with the actual subject description baked in (not generic "the person")
- Set intensity (denoising strength) appropriate to how dramatic the change is: subtle 0.5-0.6, moderate 0.6-0.75, dramatic 0.75-0.95
- Each pitch is a one-liner the stylist would say to sell the look — cheeky, confident, fun
- Categories should be relevant to what the client asked for
- Keep negative prompts consistent: "deformed, distorted, bad quality, blurry"
- Generate unique IDs for each transformation (use descriptive slugs like "copper-auburn-hair")
- Include emoji icons that match each transformation
- Return a \`recommendedCategory\` field with the name of the category you're most excited about for this client right now.`;

  let modeInstructions = '';

  if (mode === 'refresh' && currentCategories?.length) {
    modeInstructions = `\n\nHere are the current options in the grid: ${JSON.stringify(currentCategories, null, 2)}. Reorganize completely based on the client's current look. Remove options that no longer make sense (e.g., if they just got platinum hair, don't offer the same hair colors). Add new complementary options.`;
    if (currentLook) {
      modeInstructions += `\n\nThe client currently looks like: ${currentLook}`;
    }
  } else if (mode === 'expand' && currentCategories?.length) {
    modeInstructions = `\n\nHere are the existing options. Keep ALL existing categories and options. Add new categories or more options within existing categories. Do not remove or replace anything.\n${JSON.stringify(currentCategories, null, 2)}`;
  }

  return `Based on this client's features and what they're looking for, generate transformation options organized into categories.

Client: ${JSON.stringify(photoAnalysis, null, 2)}
They want: ${intent}${modeInstructions}

Return JSON:
{
  "categories": [
    {
      "name": "Hair Color",
      "icon": "🎨",
      "transformations": [
        {
          "id": "unique-id",
          "name": "Copper Auburn",
          "prompt": "Change [subject description]'s hair color to rich copper auburn with warm highlights while preserving facial features and identity",
          "pitch": "Your warm skin tone would make this absolutely glow",
          "intensity": 0.7,
          "negativePrompt": "deformed, distorted, bad quality, blurry",
          "icon": "🔥"
        }
      ]
    }
  ],
  "recommendedCategory": "Hair Color"
}

${baseRules}`;
}

function parseGenerationResult(content: string): { categories: GeneratedCategory[]; recommendedCategory: string } {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const parsed = JSON.parse(cleaned);
  const categories = parsed.categories || parsed;

  if (!Array.isArray(categories)) {
    throw new Error('Expected categories array');
  }

  const mappedCategories = categories.map((cat: Record<string, unknown>) => ({
    name: String(cat.name || 'Looks'),
    icon: String(cat.icon || '✨'),
    transformations: (Array.isArray(cat.transformations) ? cat.transformations : []).map(
      (t: Record<string, unknown>) => ({
        id: String(t.id || `gen-${Math.random().toString(36).slice(2, 8)}`),
        name: String(t.name || 'Transformation'),
        prompt: String(t.prompt || ''),
        pitch: String(t.pitch || ''),
        intensity: typeof t.intensity === 'number' ? t.intensity : 0.65,
        negativePrompt: String(t.negativePrompt || 'deformed, distorted, bad quality, blurry'),
        icon: String(t.icon || '✨'),
      })
    ),
  }));

  const recommendedCategory = parsed.recommendedCategory || mappedCategories[0]?.name || '';

  return { categories: mappedCategories, recommendedCategory };
}

/**
 * Generate personalized transformation options via LLM.
 */
export async function generateTransformations(
  photoAnalysis: PhotoAnalysis,
  intent: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any,
  options?: {
    mode?: 'refresh' | 'expand';
    currentLook?: string;
    currentCategories?: GeneratedCategory[];
  }
): Promise<{ categories: GeneratedCategory[]; recommendedCategory: string }> {
  const prompt = buildGenerationPrompt(photoAnalysis, intent, options);

  try {
    if (sogniClient?.getChatClient) {
      // Authenticated: direct SDK
      const rawClient = sogniClient.getChatClient();
      const messages = [
        { role: 'system' as const, content: 'You are an eccentric legendary Hollywood stylist. Generate transformation options in JSON format exactly as requested.' },
        { role: 'user' as const, content: prompt },
      ];

      let fullContent = '';
      const stream = await rawClient.chat.completions.create({
        model: 'qwen3.5-35b-a3b-gguf-q4km',
        messages,
        stream: true,
        tokenType: 'spark',
        temperature: 0.8,
        max_tokens: 4000,
        think: false,
      });

      // SDK ChatStream yields { content, ... } directly (not OpenAI choices format)
      for await (const chunk of stream as AsyncIterable<{ content?: string }>) {
        if (chunk.content) fullContent += chunk.content;
      }

      return parseGenerationResult(fullContent);
    } else {
      // Demo: backend proxy
      const urls = getURLs();
      const response = await fetch(`${urls.apiUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are an eccentric legendary Hollywood stylist. Generate transformation options in JSON format exactly as requested.' },
            { role: 'user', content: prompt },
          ],
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Transformation generation failed: ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) fullContent += data.content;
            } catch {
              // ignore parse errors on individual lines
            }
          }
        }
      }

      return parseGenerationResult(fullContent);
    }
  } catch (error) {
    console.error('[TransformationService] Error generating transformations:', error);
    // Return a comprehensive fallback set
    const subject = photoAnalysis.subjectDescription || 'the person';
    const neg = 'deformed, distorted, bad quality, blurry';
    return {
      categories: [
        {
          name: 'Hair Color',
          icon: '🎨',
          transformations: [
            { id: 'fallback-platinum-blonde', name: 'Platinum Blonde', prompt: `Change ${subject}'s hair to icy platinum blonde with a luminous shine while preserving facial features and identity`, pitch: 'Platinum is always a power move', intensity: 0.75, negativePrompt: neg, icon: '🤍' },
            { id: 'fallback-copper-auburn', name: 'Copper Auburn', prompt: `Change ${subject}'s hair to rich copper auburn with warm highlights while preserving facial features and identity`, pitch: 'This warm tone is going to make your eyes pop', intensity: 0.7, negativePrompt: neg, icon: '🔥' },
            { id: 'fallback-jet-black', name: 'Jet Black', prompt: `Change ${subject}'s hair to sleek jet black with a glossy mirror-like finish while preserving facial features and identity`, pitch: 'Dramatic, mysterious, absolutely iconic', intensity: 0.7, negativePrompt: neg, icon: '🖤' },
            { id: 'fallback-rose-gold', name: 'Rose Gold', prompt: `Change ${subject}'s hair to soft rose gold with pink undertones while preserving facial features and identity`, pitch: 'Soft, trendy, and totally you', intensity: 0.7, negativePrompt: neg, icon: '🌸' },
            { id: 'fallback-deep-burgundy', name: 'Deep Burgundy', prompt: `Change ${subject}'s hair to deep burgundy red with wine-toned highlights while preserving facial features and identity`, pitch: 'Rich and sultry — a head-turner for sure', intensity: 0.7, negativePrompt: neg, icon: '🍷' },
            { id: 'fallback-honey-balayage', name: 'Honey Balayage', prompt: `Change ${subject}'s hair to a sun-kissed honey balayage with caramel highlights blended through while preserving facial features and identity`, pitch: 'Sun-kissed without the sun damage — perfection', intensity: 0.7, negativePrompt: neg, icon: '🍯' },
          ],
        },
        {
          name: 'Hairstyle',
          icon: '💇',
          transformations: [
            { id: 'fallback-sleek-bob', name: 'Sleek Bob', prompt: `Give ${subject} a sharp chin-length sleek bob haircut with clean lines while preserving facial features and identity`, pitch: 'Clean lines, maximum impact', intensity: 0.75, negativePrompt: neg, icon: '✂️' },
            { id: 'fallback-beach-waves', name: 'Beach Waves', prompt: `Give ${subject} effortless tousled beach waves with natural volume while preserving facial features and identity`, pitch: 'That effortless "just left the beach" energy', intensity: 0.65, negativePrompt: neg, icon: '🌊' },
            { id: 'fallback-hollywood-curls', name: 'Hollywood Curls', prompt: `Give ${subject} glamorous old Hollywood finger waves and soft curls while preserving facial features and identity`, pitch: 'Classic Hollywood glamour never goes out of style', intensity: 0.7, negativePrompt: neg, icon: '🌟' },
            { id: 'fallback-pixie-cut', name: 'Pixie Cut', prompt: `Give ${subject} a chic modern pixie cut with textured layers while preserving facial features and identity`, pitch: 'Bold, confident, and absolutely fierce', intensity: 0.8, negativePrompt: neg, icon: '⚡' },
            { id: 'fallback-voluminous-blowout', name: 'Voluminous Blowout', prompt: `Give ${subject} a luxurious voluminous blowout with bouncy body and movement while preserving facial features and identity`, pitch: 'Big hair, big energy — let\'s go', intensity: 0.65, negativePrompt: neg, icon: '💨' },
            { id: 'fallback-braided-updo', name: 'Braided Updo', prompt: `Give ${subject} an elegant braided updo hairstyle with intricate woven details while preserving facial features and identity`, pitch: 'Elegance with an edge — this updo means business', intensity: 0.75, negativePrompt: neg, icon: '👸' },
          ],
        },
        {
          name: 'Makeup Looks',
          icon: '💄',
          transformations: [
            { id: 'fallback-smoky-eye', name: 'Smoky Eye', prompt: `Give ${subject} a dramatic smoky eye makeup look with blended dark eyeshadow while preserving facial features and identity`, pitch: 'The smoky eye is doing all the talking', intensity: 0.6, negativePrompt: neg, icon: '🖤' },
            { id: 'fallback-natural-glow', name: 'Natural Glow', prompt: `Give ${subject} a dewy natural glow makeup look with luminous skin and soft highlights while preserving facial features and identity`, pitch: 'Glowing skin is always in season', intensity: 0.55, negativePrompt: neg, icon: '✨' },
            { id: 'fallback-bold-red-lip', name: 'Bold Red Lip', prompt: `Give ${subject} a classic bold red lip with defined liner and flawless base while preserving facial features and identity`, pitch: 'A red lip is the ultimate confidence booster', intensity: 0.6, negativePrompt: neg, icon: '💋' },
            { id: 'fallback-glam-contour', name: 'Glam Contour', prompt: `Give ${subject} a full glam contoured makeup look with sculpted cheekbones and highlighted features while preserving facial features and identity`, pitch: 'Sculpted to perfection, darling', intensity: 0.65, negativePrompt: neg, icon: '💫' },
            { id: 'fallback-cat-eye', name: 'Cat Eye', prompt: `Give ${subject} a sharp winged cat eye liner look with dramatic lashes while preserving facial features and identity`, pitch: 'Sharp enough to cut glass — love it', intensity: 0.6, negativePrompt: neg, icon: '🐱' },
            { id: 'fallback-sunset-eyes', name: 'Sunset Eyes', prompt: `Give ${subject} a warm sunset-inspired eyeshadow look blending orange, pink, and gold tones while preserving facial features and identity`, pitch: 'Golden hour, but make it permanent', intensity: 0.6, negativePrompt: neg, icon: '🌅' },
          ],
        },
        {
          name: 'Vibes & Aesthetic',
          icon: '🌟',
          transformations: [
            { id: 'fallback-red-carpet', name: 'Red Carpet Ready', prompt: `Give ${subject} a complete red carpet glamour transformation with elegant styling while preserving facial features and identity`, pitch: 'You\'re about to shut down every red carpet', intensity: 0.75, negativePrompt: neg, icon: '🏆' },
            { id: 'fallback-streetwear-cool', name: 'Streetwear Cool', prompt: `Give ${subject} an edgy modern streetwear-inspired look with urban styling while preserving facial features and identity`, pitch: 'Street style with main character energy', intensity: 0.7, negativePrompt: neg, icon: '🔥' },
            { id: 'fallback-ethereal', name: 'Ethereal Fantasy', prompt: `Give ${subject} an ethereal dreamy fantasy look with soft glowing features and romantic styling while preserving facial features and identity`, pitch: 'Giving fairy tale protagonist realness', intensity: 0.75, negativePrompt: neg, icon: '🧚' },
            { id: 'fallback-retro-vintage', name: 'Retro Vintage', prompt: `Give ${subject} a retro vintage 1960s inspired look with classic styling while preserving facial features and identity`, pitch: 'Timeless vintage — because classics never die', intensity: 0.7, negativePrompt: neg, icon: '📷' },
            { id: 'fallback-punk-edge', name: 'Punk Edge', prompt: `Give ${subject} a bold punk-inspired look with edgy dramatic styling while preserving facial features and identity`, pitch: 'Rules are meant to be broken, gorgeous', intensity: 0.8, negativePrompt: neg, icon: '🎸' },
            { id: 'fallback-90s-supermodel', name: '90s Supermodel', prompt: `Give ${subject} a 1990s supermodel look with brown liner, nude lip, and effortless blown-out hair while preserving facial features and identity`, pitch: 'Cindy Crawford called — she wants her vibe back', intensity: 0.7, negativePrompt: neg, icon: '🕶️' },
          ],
        },
        {
          name: 'Skin & Glow',
          icon: '💎',
          transformations: [
            { id: 'fallback-glass-skin', name: 'Glass Skin', prompt: `Give ${subject} a flawless dewy glass skin complexion with a luminous healthy glow while preserving facial features and identity`, pitch: 'That lit-from-within glow everyone is chasing', intensity: 0.5, negativePrompt: neg, icon: '💧' },
            { id: 'fallback-sun-kissed', name: 'Sun-Kissed Bronze', prompt: `Give ${subject} a warm sun-kissed bronzed complexion with natural freckles and golden glow while preserving facial features and identity`, pitch: 'Fresh off a Mediterranean vacation — no passport needed', intensity: 0.55, negativePrompt: neg, icon: '☀️' },
            { id: 'fallback-porcelain', name: 'Porcelain Finish', prompt: `Give ${subject} a smooth flawless porcelain skin finish with an even matte complexion while preserving facial features and identity`, pitch: 'Flawless doesn\'t even begin to cover it', intensity: 0.5, negativePrompt: neg, icon: '🤍' },
            { id: 'fallback-rosy-cheeks', name: 'Rosy Flush', prompt: `Give ${subject} a fresh rosy-cheeked flush with natural pink blushed cheeks and healthy radiance while preserving facial features and identity`, pitch: 'That just-pinched-your-cheeks freshness', intensity: 0.5, negativePrompt: neg, icon: '🌹' },
            { id: 'fallback-airbrushed', name: 'Airbrushed Glam', prompt: `Give ${subject} a smooth airbrushed glamour complexion with soft-focus skin and highlighted cheekbones while preserving facial features and identity`, pitch: 'Magazine cover ready — no retouching needed', intensity: 0.55, negativePrompt: neg, icon: '📸' },
            { id: 'fallback-natural-beauty', name: 'Natural Beauty', prompt: `Enhance ${subject}'s natural features with minimal subtle improvements for a fresh-faced clean beauty look while preserving facial features and identity`, pitch: 'Just you, but turned up to eleven', intensity: 0.45, negativePrompt: neg, icon: '🌿' },
          ],
        },
        {
          name: 'Outfit & Style',
          icon: '👗',
          transformations: [
            { id: 'fallback-leather-jacket', name: 'Leather Jacket', prompt: `Put ${subject} in a stylish black leather jacket with an effortlessly cool look while preserving facial features and identity`, pitch: 'Instant attitude upgrade — leather never lies', intensity: 0.7, negativePrompt: neg, icon: '🧥' },
            { id: 'fallback-elegant-blazer', name: 'Power Blazer', prompt: `Put ${subject} in a tailored power blazer with sharp shoulders and a polished professional look while preserving facial features and identity`, pitch: 'Boss energy — the boardroom won\'t know what hit it', intensity: 0.7, negativePrompt: neg, icon: '💼' },
            { id: 'fallback-evening-gown', name: 'Evening Gown', prompt: `Put ${subject} in a stunning elegant evening gown with luxurious draping and glamorous styling while preserving facial features and identity`, pitch: 'Red carpet ready from head to toe', intensity: 0.75, negativePrompt: neg, icon: '👗' },
            { id: 'fallback-streetwear-hoodie', name: 'Streetwear Hoodie', prompt: `Put ${subject} in a trendy oversized streetwear hoodie with an urban casual vibe while preserving facial features and identity`, pitch: 'Cozy meets cool — the best combo', intensity: 0.65, negativePrompt: neg, icon: '🔥' },
            { id: 'fallback-denim-jacket', name: 'Denim Jacket', prompt: `Put ${subject} in a classic denim jacket with a casual effortless style while preserving facial features and identity`, pitch: 'A denim jacket makes everything better — fact', intensity: 0.65, negativePrompt: neg, icon: '👖' },
            { id: 'fallback-silk-blouse', name: 'Silk Blouse', prompt: `Put ${subject} in a luxurious silk blouse with an elegant refined look while preserving facial features and identity`, pitch: 'Effortless elegance — silk does all the work', intensity: 0.65, negativePrompt: neg, icon: '✨' },
          ],
        },
        {
          name: 'Accessories',
          icon: '💎',
          transformations: [
            { id: 'fallback-statement-glasses', name: 'Statement Glasses', prompt: `Add stylish bold statement eyeglasses to ${subject} while preserving facial features and identity`, pitch: 'Smart AND stylish — the full package', intensity: 0.55, negativePrompt: neg, icon: '🤓' },
            { id: 'fallback-statement-earrings', name: 'Statement Earrings', prompt: `Add glamorous large statement earrings to ${subject} while preserving facial features and identity`, pitch: 'The earrings that steal the show', intensity: 0.55, negativePrompt: neg, icon: '💍' },
            { id: 'fallback-sunglasses', name: 'Designer Sunglasses', prompt: `Add sleek designer sunglasses to ${subject} while preserving facial features and identity`, pitch: 'Instant cool factor — just add shades', intensity: 0.55, negativePrompt: neg, icon: '😎' },
            { id: 'fallback-headband', name: 'Chic Headband', prompt: `Add a fashionable embellished headband to ${subject}'s hair while preserving facial features and identity`, pitch: 'A little detail that changes everything', intensity: 0.5, negativePrompt: neg, icon: '👑' },
            { id: 'fallback-choker', name: 'Elegant Choker', prompt: `Add an elegant choker necklace to ${subject} while preserving facial features and identity`, pitch: 'The perfect finishing touch', intensity: 0.5, negativePrompt: neg, icon: '📿' },
            { id: 'fallback-hat', name: 'Wide-Brim Hat', prompt: `Add a chic wide-brim hat to ${subject} for a fashionable sophisticated look while preserving facial features and identity`, pitch: 'A hat this good should be illegal', intensity: 0.6, negativePrompt: neg, icon: '🎩' },
          ],
        },
        {
          name: 'Eye Color',
          icon: '👁️',
          transformations: [
            { id: 'fallback-emerald-eyes', name: 'Emerald Green', prompt: `Change ${subject}'s eye color to striking emerald green while preserving facial features and identity`, pitch: 'Green eyes that stop traffic', intensity: 0.55, negativePrompt: neg, icon: '💚' },
            { id: 'fallback-ice-blue', name: 'Ice Blue', prompt: `Change ${subject}'s eye color to piercing ice blue while preserving facial features and identity`, pitch: 'Those baby blues are going to be legendary', intensity: 0.55, negativePrompt: neg, icon: '💙' },
            { id: 'fallback-honey-amber', name: 'Honey Amber', prompt: `Change ${subject}'s eye color to warm honey amber with golden flecks while preserving facial features and identity`, pitch: 'Warm, golden, and absolutely mesmerizing', intensity: 0.55, negativePrompt: neg, icon: '🍯' },
            { id: 'fallback-violet-eyes', name: 'Violet', prompt: `Change ${subject}'s eye color to a rare striking violet purple while preserving facial features and identity`, pitch: 'Elizabeth Taylor energy — iconic', intensity: 0.55, negativePrompt: neg, icon: '💜' },
            { id: 'fallback-hazel-eyes', name: 'Warm Hazel', prompt: `Change ${subject}'s eye color to warm hazel with green and brown tones while preserving facial features and identity`, pitch: 'Hazel eyes that shift in every light', intensity: 0.5, negativePrompt: neg, icon: '🤎' },
            { id: 'fallback-steel-grey', name: 'Steel Grey', prompt: `Change ${subject}'s eye color to cool steel grey while preserving facial features and identity`, pitch: 'Mysterious and magnetic — impossible to look away', intensity: 0.55, negativePrompt: neg, icon: '🩶' },
          ],
        },
        {
          name: 'Facial Hair',
          icon: '🧔',
          transformations: [
            { id: 'fallback-clean-shave', name: 'Clean Shave', prompt: `Give ${subject} a perfectly clean-shaven smooth face while preserving facial features and identity`, pitch: 'Fresh-faced and flawless', intensity: 0.6, negativePrompt: neg, icon: '✨' },
            { id: 'fallback-designer-stubble', name: 'Designer Stubble', prompt: `Give ${subject} perfectly groomed designer stubble with a rugged refined look while preserving facial features and identity`, pitch: 'That effortless five o\'clock shadow — chefs kiss', intensity: 0.55, negativePrompt: neg, icon: '😏' },
            { id: 'fallback-full-beard', name: 'Full Beard', prompt: `Give ${subject} a thick well-groomed full beard with clean edges while preserving facial features and identity`, pitch: 'A beard this good takes commitment — or just one click', intensity: 0.65, negativePrompt: neg, icon: '🧔' },
            { id: 'fallback-goatee', name: 'Classic Goatee', prompt: `Give ${subject} a sharp classic goatee with clean lines while preserving facial features and identity`, pitch: 'Focused, intentional, and sharp as ever', intensity: 0.6, negativePrompt: neg, icon: '🎯' },
            { id: 'fallback-mustache', name: 'Statement Mustache', prompt: `Give ${subject} a bold statement mustache with a classic vintage flair while preserving facial features and identity`, pitch: 'The mustache is making a comeback and you\'re leading the charge', intensity: 0.6, negativePrompt: neg, icon: '🥸' },
            { id: 'fallback-mutton-chops', name: 'Mutton Chops', prompt: `Give ${subject} bold retro mutton chop sideburns with a distinctive look while preserving facial features and identity`, pitch: 'Wolverine wishes he looked this good', intensity: 0.65, negativePrompt: neg, icon: '🐺' },
          ],
        },
      ],
      recommendedCategory: 'Hair Color',
    };
  }
}
