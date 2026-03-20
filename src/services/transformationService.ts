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
          ],
        },
        {
          name: 'Accessories',
          icon: '👓',
          transformations: [
            { id: 'fallback-statement-glasses', name: 'Statement Glasses', prompt: `Add stylish bold statement eyeglasses to ${subject} while preserving facial features and identity`, pitch: 'Smart AND stylish — the full package', intensity: 0.55, negativePrompt: neg, icon: '🤓' },
            { id: 'fallback-statement-earrings', name: 'Statement Earrings', prompt: `Add glamorous large statement earrings to ${subject} while preserving facial features and identity`, pitch: 'The earrings that steal the show', intensity: 0.55, negativePrompt: neg, icon: '💎' },
            { id: 'fallback-headband', name: 'Chic Headband', prompt: `Add a fashionable embellished headband to ${subject}'s hair while preserving facial features and identity`, pitch: 'A little detail that changes everything', intensity: 0.5, negativePrompt: neg, icon: '👑' },
            { id: 'fallback-sunglasses', name: 'Designer Sunglasses', prompt: `Add sleek designer sunglasses to ${subject} while preserving facial features and identity`, pitch: 'Instant cool factor — just add shades', intensity: 0.55, negativePrompt: neg, icon: '😎' },
            { id: 'fallback-choker', name: 'Elegant Choker', prompt: `Add an elegant choker necklace to ${subject} while preserving facial features and identity`, pitch: 'The perfect finishing touch', intensity: 0.5, negativePrompt: neg, icon: '📿' },
          ],
        },
      ],
      recommendedCategory: 'Hair Color',
    };
  }
}
