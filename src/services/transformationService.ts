import type { GeneratedCategory, GeneratedTransformation, PhotoAnalysis } from '@/types/chat';
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

  const genderNote = photoAnalysis.perceivedGender === 'female'
    ? '- Do NOT include facial hair categories or options — the client is female.'
    : photoAnalysis.perceivedGender === 'male'
      ? '- Include a Facial Hair category with beard, stubble, mustache, and clean-shave options.'
      : '- If the client appears male, include a Facial Hair category. If female, skip it.';

  const baseRules = `Rules:
- REALISM FIRST: All options should be professional, realistic makeover transformations — the kind a real salon, stylist, or makeover show would offer. Think real hair colors, real makeup techniques, real fashion. Avoid fantastical, costume-like, or sci-fi options (e.g. no "galaxy hair", "fairy wings", "cyberpunk visor", "alien glow") UNLESS the client explicitly asks for creative, fantasy, or out-there looks.
- INTENT-FOCUSED CATEGORIES: When the client asks for something specific (e.g. "change my hairstyle", "new makeup looks", "show me outfits"), ALL or most categories should be sub-categories within that area. For example, if they say "change my hairstyle", generate categories like "Short & Cropped", "Long & Flowing", "Updos & Braids", "Curls & Waves", "Retro & Vintage Styles", "Edgy & Bold Cuts" — all focused on hairstyles. Only include 1-2 adjacent categories if they naturally complement the request. When the intent is broad or general, THEN use a diverse spread.
- Category names MUST be 3 words or fewer (e.g. "Hair Color", "Bold Makeup", "Skin & Glow"). Never use long names like "Retro & Vintage Styles" — shorten to "Retro Styles".
- You MUST generate at least 6 categories with at least 6 transformation options each. More is better — aim for 8+ categories when the client's request allows it.
- NEVER return fewer than 4 categories. A single "Quick Looks" category with 2 options is unacceptable.
- For broad/general intents, good category examples: Hair Color, Hairstyle, Makeup Looks, Vibes & Aesthetic, Skin & Glow, Outfit & Style, Accessories, Eye Color, Facial Hair
${genderNote}
- Write prompts with the actual subject description baked in (not generic "the person")
- Set intensity (denoising strength) appropriate to how dramatic the change is: subtle 0.5-0.6, moderate 0.6-0.75, dramatic 0.75-0.95
- Each pitch is a one-liner the stylist would say to sell the look — cheeky, confident, fun
- Categories should be relevant to what the client asked for
- Keep negative prompts consistent: "deformed, distorted, bad quality, blurry"
- Generate unique IDs for each transformation (use descriptive slugs like "copper-auburn-hair")
- Include emoji icons that match each transformation
- Include a \`thumbnailPrompt\` for each transformation: a DETAILED text-to-image prompt (80-150 words) for a 512x512 preview. Z-Image Turbo rewards lengthy, structured, precise descriptions — never write short vague prompts. Follow this structure: [Shot type & subject] + [Age & appearance with skin tone] + [Specific details of the look] + [Environment/background] + [Lighting] + [Mood] + [Style/medium] + [Artifact control]. IMPORTANT: always include the client's skin tone (e.g. "${photoAnalysis.features.skinTone || 'medium'} skin tone") and approximate age (e.g. "${photoAnalysis.estimatedAgeRange || 'adult'}"). Z-Image Turbo does NOT support negative prompts — all quality constraints must be embedded in the positive prompt. Always include: "sharp focus on subject, clean detailed image, correct human anatomy, no text, no watermark, no logos, no UI elements, simple uncluttered background". Be specific about lighting — the model responds strongly to lighting keywords (e.g. "soft diffused daylight from the front", "studio portrait lighting with subtle rim light", "warm key light from upper left"). CRITICAL FRAMING RULE: Thumbnails are small (512x512 displayed even smaller), so frame each preview as a tight professional closeup of the SPECIFIC detail being changed. Fine details like lips, earrings, eye color, and small accessories MUST fill most of the frame — do not show the full face when only the lips or ears matter. For hair: tight close-up of the hairstyle filling the frame, on a person with matching skin tone and age. For lip shades/lip looks: extreme close-up of the lips and lower face only, showing the lip color and finish in detail. For eye makeup/eye color: extreme close-up of the eye area only, showing the specific look in crisp detail. For earrings/ear accessories: tight close-up of the ear and earring filling the frame, with the client's skin tone visible. For other accessories (glasses, hats, necklaces): close-up framed so the accessory is the dominant element. For outfits: upper-body shot showing the garment clearly on a person with matching complexion. Always specify "realistic photograph" as the style/medium.
- Include a \`thumbnailPrompt\` for each CATEGORY too: a SINGLE representative image (not a grid or collage) that captures the category's essence, matched to the client's skin tone and age. Use the same detailed structure as transformation thumbnailPrompts (80-150 words, structured, with artifact control clauses). Example for "Hair Color": "A close-up portrait shot of flowing styled hair on a ${photoAnalysis.features.skinTone || 'medium'} skin tone ${photoAnalysis.estimatedAgeRange || 'adult'}, rich natural hair texture with subtle highlights catching the light, soft diffused studio portrait lighting with gentle rim light from behind, warm inviting mood, plain neutral gray studio background, realistic photograph, sharp focus on subject, clean detailed image, correct human anatomy, no text, no watermark, no logos, no UI elements, simple uncluttered background". NEVER use words like "various", "multiple", "collection", "grid", or "swatches" — always depict ONE subject or ONE item.
- Return a \`recommendedCategory\` field with the name of the category you're most excited about for this client right now.
- CRITICAL CATEGORY ANCHORING: Every transformation \`prompt\` MUST explicitly name the category area being changed (e.g., a Hair Color transformation must say "Change hair color to..." not just "Change to..."). The prompt must ONLY describe changes to that category's area — do NOT describe changes to unrelated areas (e.g., a Hairstyle prompt must NOT change clothing, a Hair Color prompt must NOT change the outfit). If the transformation name uses a color or texture word (like "Charcoal", "Chocolate", "Platinum"), the prompt MUST make clear this applies to the relevant feature (hair, skin, etc.), NOT to clothing or other features.
- CRITICAL THUMBNAIL ANCHORING: Each \`thumbnailPrompt\` must depict ONLY the specific feature being changed by that category — nothing else. Do NOT let color/texture words in the transformation name bleed into unrelated areas. For example, a "Dark Chocolate Texture" hairstyle thumbnail must describe dark chocolate colored HAIR, not a brown shirt. Always explicitly state what feature has the color/texture (e.g., "dark chocolate brown textured hair" NOT "dark chocolate texture").`;

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
      "thumbnailPrompt": "A close-up portrait shot of flowing styled hair on a warm olive skin tone young adult, rich natural hair texture with subtle highlights catching the light, soft diffused studio portrait lighting with gentle rim light from behind, warm inviting mood, plain neutral gray studio background, realistic photograph, sharp focus on subject, clean detailed image, correct human anatomy, no text, no watermark, no logos, no UI elements, simple uncluttered background",
      "transformations": [
        {
          "id": "unique-id",
          "name": "Copper Auburn",
          "prompt": "Change [subject description]'s hair color to rich copper auburn with warm highlights while preserving facial features and identity",
          "thumbnailPrompt": "A close-up beauty shot of rich copper auburn hair with warm golden highlights on a warm olive skin tone young adult, silky hair texture with natural movement and shine, soft diffused studio portrait lighting with subtle warm rim light from behind, confident elegant mood, plain neutral gray studio background, realistic photograph, sharp focus on subject, clean detailed image, correct human anatomy, no text, no watermark, no logos, no UI elements, simple uncluttered background",
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

/** Truncate a category name to at most 3 words. */
function truncateCategoryName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length <= 3 ? name.trim() : words.slice(0, 3).join(' ');
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
    name: truncateCategoryName(String(cat.name || 'Looks')),
    icon: String(cat.icon || '✨'),
    thumbnailPrompt: cat.thumbnailPrompt ? String(cat.thumbnailPrompt) : undefined,
    transformations: (Array.isArray(cat.transformations) ? cat.transformations : []).map(
      (t: Record<string, unknown>) => ({
        id: String(t.id || `gen-${Math.random().toString(36).slice(2, 8)}`),
        name: String(t.name || 'Transformation'),
        prompt: String(t.prompt || ''),
        thumbnailPrompt: t.thumbnailPrompt ? String(t.thumbnailPrompt) : undefined,
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
        { role: 'system' as const, content: 'You are a professional Hollywood stylist. Generate realistic, salon-quality transformation options in JSON format exactly as requested. Keep suggestions grounded and professional unless the client explicitly asks for fantasy or creative looks.' },
        { role: 'user' as const, content: prompt },
      ];

      let fullContent = '';
      const stream = await rawClient.chat.completions.create({
        model: 'qwen3.5-35b-a3b-gguf-q4km',
        messages,
        stream: true,
        tokenType: 'spark',
        temperature: 0.8,
        max_tokens: 15000,
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
            { role: 'system', content: 'You are a professional Hollywood stylist. Generate realistic, salon-quality transformation options in JSON format exactly as requested. Keep suggestions grounded and professional unless the client explicitly asks for fantasy or creative looks.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 15000,
          temperature: 0.8,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Transformation generation failed: ${response.status}`);
      }

      // Read SSE stream with proper line buffering
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
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
    // Return a comprehensive fallback set, filtered by perceived gender
    const subject = photoAnalysis.subjectDescription || 'the person';
    const gender = photoAnalysis.perceivedGender; // 'male' | 'female' | null
    const neg = 'deformed, distorted, bad quality, blurry';

    const categories: GeneratedCategory[] = [
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
          { id: 'fallback-streetwear-hoodie', name: 'Streetwear Hoodie', prompt: `Put ${subject} in a trendy oversized streetwear hoodie with an urban casual vibe while preserving facial features and identity`, pitch: 'Cozy meets cool — the best combo', intensity: 0.65, negativePrompt: neg, icon: '🔥' },
          { id: 'fallback-denim-jacket', name: 'Denim Jacket', prompt: `Put ${subject} in a classic denim jacket with a casual effortless style while preserving facial features and identity`, pitch: 'A denim jacket makes everything better — fact', intensity: 0.65, negativePrompt: neg, icon: '👖' },
          ...(gender === 'female' ? [
            { id: 'fallback-evening-gown', name: 'Evening Gown', prompt: `Put ${subject} in a stunning elegant evening gown with luxurious draping and glamorous styling while preserving facial features and identity`, pitch: 'Red carpet ready from head to toe', intensity: 0.75, negativePrompt: neg, icon: '👗' },
            { id: 'fallback-silk-blouse', name: 'Silk Blouse', prompt: `Put ${subject} in a luxurious silk blouse with an elegant refined look while preserving facial features and identity`, pitch: 'Effortless elegance — silk does all the work', intensity: 0.65, negativePrompt: neg, icon: '✨' },
          ] : gender === 'male' ? [
            { id: 'fallback-sharp-suit', name: 'Sharp Suit', prompt: `Put ${subject} in a perfectly tailored sharp suit with a crisp dress shirt and modern fit while preserving facial features and identity`, pitch: 'A suit this sharp should come with a warning label', intensity: 0.75, negativePrompt: neg, icon: '🤵' },
            { id: 'fallback-bomber-jacket', name: 'Bomber Jacket', prompt: `Put ${subject} in a sleek bomber jacket with a casual confident style while preserving facial features and identity`, pitch: 'Top Gun energy — you\'re cleared for takeoff', intensity: 0.65, negativePrompt: neg, icon: '🧥' },
          ] : [
            { id: 'fallback-evening-formal', name: 'Evening Formal', prompt: `Put ${subject} in stunning elegant formal evening wear with luxurious styling while preserving facial features and identity`, pitch: 'Red carpet ready from head to toe', intensity: 0.75, negativePrompt: neg, icon: '👔' },
            { id: 'fallback-casual-chic', name: 'Casual Chic', prompt: `Put ${subject} in a stylish casual-chic outfit with an effortlessly polished look while preserving facial features and identity`, pitch: 'Looking this good shouldn\'t be this easy', intensity: 0.65, negativePrompt: neg, icon: '✨' },
          ]),
        ],
      },
      {
        name: 'Accessories',
        icon: '💍',
        transformations: [
          { id: 'fallback-statement-glasses', name: 'Statement Glasses', prompt: `Add stylish bold statement eyeglasses to ${subject} while preserving facial features and identity`, pitch: 'Smart AND stylish — the full package', intensity: 0.55, negativePrompt: neg, icon: '🤓' },
          { id: 'fallback-statement-earrings', name: 'Statement Earrings', prompt: `Add glamorous large statement earrings to ${subject} while preserving facial features and identity`, pitch: 'The earrings that steal the show', intensity: 0.55, negativePrompt: neg, icon: '💎' },
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
    ];

    // Only include Facial Hair for male or unknown gender
    if (gender !== 'female') {
      categories.push({
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
      });
    }

    return { categories, recommendedCategory: 'Hair Color' };
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Category Shells (fast, ~500 tokens output)
// ---------------------------------------------------------------------------

function buildCategoryShellPrompt(
  photoAnalysis: PhotoAnalysis,
  intent: string,
  options?: {
    mode?: 'refresh' | 'expand';
    currentCategories?: GeneratedCategory[];
  }
): string {
  const mode = options?.mode || 'refresh';
  const currentCategories = options?.currentCategories;

  const genderNote = photoAnalysis.perceivedGender === 'female'
    ? '- Do NOT include facial hair categories — the client is female.'
    : photoAnalysis.perceivedGender === 'male'
      ? '- Include a Facial Hair category.'
      : '- If the client appears male, include a Facial Hair category. If female, skip it.';

  let modeInstructions = '';

  if (mode === 'refresh' && currentCategories?.length) {
    const categoryNames = currentCategories.map(c => c.name).join(', ');
    modeInstructions = `\n\nCurrent categories in the grid: ${categoryNames}. Reorganize completely based on the client's current look. Replace categories that no longer make sense.`;
  } else if (mode === 'expand' && currentCategories?.length) {
    const categoryNames = currentCategories.map(c => c.name).join(', ');
    modeInstructions = `\n\nExisting categories: ${categoryNames}. Keep all existing categories and add new ones. Do not remove or replace anything.`;
  }

  return `Based on this client's features and what they're looking for, generate category names for transformation options.

Client: ${JSON.stringify(photoAnalysis, null, 2)}
They want: ${intent}${modeInstructions}

Return ONLY category shells — no transformation options. Return JSON:
{
  "categories": [
    { "name": "Hair Color", "icon": "🎨", "description": "Rich colors and highlights tailored to your warm skin tone", "thumbnailPrompt": "A close-up portrait shot of flowing styled hair on a ${photoAnalysis.features.skinTone || 'medium'} skin tone ${photoAnalysis.estimatedAgeRange || 'adult'}, rich natural hair texture with subtle highlights catching the light, soft diffused studio portrait lighting with gentle rim light from behind, warm inviting mood, plain neutral gray studio background, realistic photograph, sharp focus on subject, clean detailed image, correct human anatomy, no text, no watermark, no logos, no UI elements, simple uncluttered background" }
  ],
  "recommendedCategory": "Hair Color"
}

Rules:
- REALISM FIRST: Categories should reflect professional, realistic makeover options — the kind a real salon or stylist would offer. Avoid fantastical or costume-like categories (e.g. no "Fairy Tale Looks", "Sci-Fi Vibes", "Mythical Creatures") UNLESS the client explicitly asks for creative or fantasy options.
- INTENT-FOCUSED CATEGORIES: When the client asks for something specific (e.g. "change my hairstyle", "new makeup looks", "show me outfits"), ALL or most categories should be sub-categories within that area. For example, if they say "change my hairstyle", generate categories like "Short & Cropped", "Long & Flowing", "Updos & Braids", "Curls & Waves", "Retro & Vintage Styles", "Edgy & Bold Cuts", etc. — all focused on hairstyles. Do NOT fall back to broad categories like "Hair Color, Makeup, Outfit, Accessories" when the client has a specific focus. The intent IS the category — break it into meaningful sub-categories. Only include 1-2 adjacent categories if they naturally complement the request (e.g., "Hair Color" alongside hairstyle categories).
- When the intent is broad or general (e.g. "show me everything", "full makeover", "what do you think?"), THEN use a diverse spread of categories across different areas.
- Generate up to 8 categories. Aim for 6-8 when the client's request allows it.
- NEVER return fewer than 4 categories.
- For broad/general intents, good category examples: Hair Color, Hairstyle, Makeup Looks, Vibes & Aesthetic, Skin & Glow, Outfit & Style, Accessories, Eye Color, Facial Hair
${genderNote}
- Category names MUST be 3 words or fewer (e.g. "Hair Color", "Bold Makeup", "Skin & Glow"). Never use long names like "Retro & Vintage Styles" — shorten to "Retro Styles".
- Each description should be a brief one-liner (under 15 words) that explains what the category offers, personalized to the client
- Include an emoji icon for each category
- Return a \`recommendedCategory\` field with the name of the category you're most excited about for this client right now
- Include a \`thumbnailPrompt\` for each category: a DETAILED text-to-image prompt (80-150 words) for a 512x512 preview image that captures the category's essence. Frame as a tight close-up of the SPECIFIC feature area. Match the client's skin tone ("${photoAnalysis.features.skinTone || 'medium'} skin tone") and age ("${photoAnalysis.estimatedAgeRange || 'adult'}"). Use this structure: [Shot type & subject] + [Specific details of the look] + [Lighting] + [Background] + [Style]. Always include: "realistic photograph, sharp focus on subject, clean detailed image, correct human anatomy, no text, no watermark, no logos, no UI elements, simple uncluttered background". NEVER use words like "various", "multiple", "collection", "grid", or "swatches" — always depict ONE subject or ONE item.
- Do NOT include transformation options — only category name, icon, description, and thumbnailPrompt`;
}

function parseCategoryShellResult(content: string): { categories: GeneratedCategory[]; recommendedCategory: string } {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const parsed = JSON.parse(cleaned);
  const categories = parsed.categories || parsed;

  if (!Array.isArray(categories)) {
    throw new Error('Expected categories array');
  }

  const mappedCategories: GeneratedCategory[] = categories.map((cat: Record<string, unknown>) => ({
    name: truncateCategoryName(String(cat.name || 'Looks')),
    icon: String(cat.icon || '✨'),
    description: cat.description ? String(cat.description) : undefined,
    thumbnailPrompt: cat.thumbnailPrompt ? String(cat.thumbnailPrompt) : undefined,
    transformations: [],
    populated: false,
  }));

  const recommendedCategory = parsed.recommendedCategory || mappedCategories[0]?.name || '';

  return { categories: mappedCategories, recommendedCategory };
}

/**
 * Phase 1: Generate category shells only (fast).
 * Returns categories with populated=false and empty transformations.
 */
export async function generateCategoryShells(
  photoAnalysis: PhotoAnalysis,
  intent: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any,
  options?: {
    mode?: 'refresh' | 'expand';
    currentCategories?: GeneratedCategory[];
  }
): Promise<{ categories: GeneratedCategory[]; recommendedCategory: string }> {
  const prompt = buildCategoryShellPrompt(photoAnalysis, intent, options);

  try {
    if (sogniClient?.getChatClient) {
      // Authenticated: direct SDK
      const rawClient = sogniClient.getChatClient();
      const messages = [
        { role: 'system' as const, content: 'You are a professional Hollywood stylist. Generate realistic, salon-quality category names in JSON format exactly as requested. Keep suggestions grounded and professional unless the client explicitly asks for fantasy or creative looks.' },
        { role: 'user' as const, content: prompt },
      ];

      let fullContent = '';
      const stream = await rawClient.chat.completions.create({
        model: 'qwen3.5-35b-a3b-gguf-q4km',
        messages,
        stream: true,
        tokenType: 'spark',
        temperature: 0.8,
        max_tokens: 2000,
        think: false,
      });

      // SDK ChatStream yields { content, ... } directly (not OpenAI choices format)
      for await (const chunk of stream as AsyncIterable<{ content?: string }>) {
        if (chunk.content) fullContent += chunk.content;
      }

      return parseCategoryShellResult(fullContent);
    } else {
      // Demo: backend proxy
      const urls = getURLs();
      const response = await fetch(`${urls.apiUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a professional Hollywood stylist. Generate realistic, salon-quality category names in JSON format exactly as requested. Keep suggestions grounded and professional unless the client explicitly asks for fantasy or creative looks.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 2000,
          temperature: 0.8,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Category shell generation failed: ${response.status}`);
      }

      // Read SSE stream with proper line buffering
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
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

      return parseCategoryShellResult(fullContent);
    }
  } catch (error) {
    console.error('[TransformationService] Error generating category shells:', error);
    // Return fallback categories as shells (populated=false, no transformations)
    const gender = photoAnalysis.perceivedGender;

    const fallbackShells: GeneratedCategory[] = [
      { name: 'Hair Color', icon: '🎨', description: 'Bold and subtle hair color transformations', transformations: [], populated: false },
      { name: 'Hairstyle', icon: '💇', description: 'Fresh cuts and styles to frame your face', transformations: [], populated: false },
      { name: 'Makeup Looks', icon: '💄', description: 'Glamorous to natural makeup transformations', transformations: [], populated: false },
      { name: 'Vibes & Aesthetic', icon: '🌟', description: 'Complete aesthetic transformations and moods', transformations: [], populated: false },
      { name: 'Skin & Glow', icon: '💎', description: 'Radiant skin finishes and complexion looks', transformations: [], populated: false },
      { name: 'Outfit & Style', icon: '👗', description: 'Wardrobe changes and fashion looks', transformations: [], populated: false },
      { name: 'Accessories', icon: '💍', description: 'Statement pieces to complete any look', transformations: [], populated: false },
      { name: 'Eye Color', icon: '👁️', description: 'Striking eye color transformations', transformations: [], populated: false },
    ];

    if (gender !== 'female') {
      fallbackShells.push({ name: 'Facial Hair', icon: '🧔', description: 'Beards, stubble, and grooming styles', transformations: [], populated: false });
    }

    return { categories: fallbackShells, recommendedCategory: 'Hair Color' };
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Category Options (on-demand, ~2-4k tokens output)
// ---------------------------------------------------------------------------

function buildCategoryOptionsPrompt(
  photoAnalysis: PhotoAnalysis,
  categoryName: string,
  categoryDescription: string,
  options?: { currentLook?: string }
): string {
  const currentLook = options?.currentLook;
  const skinTone = photoAnalysis.features.skinTone || 'medium';
  const ageRange = photoAnalysis.estimatedAgeRange || 'adult';

  let lookContext = '';
  if (currentLook) {
    lookContext = `\n\nThe client currently looks like: ${currentLook}. Generate options that complement or build on their current look.`;
  }

  return `Generate 9 transformation options for the "${categoryName}" category.

Category description: ${categoryDescription}
Client: ${JSON.stringify(photoAnalysis, null, 2)}${lookContext}

Return JSON:
{
  "transformations": [
    {
      "id": "copper-auburn-hair",
      "name": "Copper Auburn",
      "prompt": "Change [subject description]'s hair color to rich copper auburn with warm highlights while preserving facial features and identity",
      "thumbnailPrompt": "Tight close-up of rich copper auburn hair with warm golden highlights filling the frame, silky texture with natural movement and shine on a ${skinTone} skin tone ${ageRange}, plain neutral gray studio background, soft diffused studio portrait lighting with subtle warm rim light, confident elegant mood, realistic photograph, professional photography, soft studio lighting, sharp focus on subject, clean detailed image, no text, no watermark, no logos, no UI elements",
      "pitch": "Your warm skin tone would make this absolutely glow",
      "intensity": 0.7,
      "negativePrompt": "deformed, distorted, bad quality, blurry",
      "icon": "🔥"
    }
  ]
}

Rules:
- REALISM FIRST: All options should be professional, realistic transformations — things a real stylist, salon, or makeover artist would actually do. Stay grounded: real hair colors, real makeup techniques, real fashion and accessories. Avoid fantastical, costume-like, or sci-fi options UNLESS the client explicitly asked for creative or fantasy looks.
- Generate exactly 9 transformation options for the "${categoryName}" category
- Write prompts with the actual subject description baked in (not generic "the person"): use "${photoAnalysis.subjectDescription || 'the person'}" as the subject
- Set intensity (denoising strength) appropriate to how dramatic the change is: subtle 0.5-0.6, moderate 0.6-0.75, dramatic 0.75-0.95
- Each pitch is a one-liner the stylist would say to sell the look — cheeky, confident, fun
- Keep negative prompts consistent: "deformed, distorted, bad quality, blurry"
- Generate unique IDs for each transformation (use descriptive slugs like "copper-auburn-hair")
- Include emoji icons that match each transformation
- Include a \`thumbnailPrompt\` for each transformation: a DETAILED text-to-image prompt (80-150 words) for a 512x512 preview. IMPORTANT: always include the client's skin tone (e.g. "${skinTone} skin tone") and approximate age (e.g. "${ageRange}") so the preview matches the client. CRITICAL FRAMING: Thumbnails are small, so frame each as a tight professional closeup of the SPECIFIC detail being changed — fine details like lips, earrings, eye color must fill most of the frame. For lip looks: extreme close-up of lips and lower face only. For eye looks/eye color: extreme close-up of the eye area only. For earrings: tight close-up of ear and earring filling the frame. For hair: tight close-up of the hairstyle filling the frame. For accessories: close-up so the item dominates. For outfits: upper-body shot showing the garment clearly. Always end with "realistic photograph, professional photography, soft studio lighting".
- Make options diverse — cover a range from subtle to dramatic within the category
- Personalize options based on the client's features
- CRITICAL CATEGORY ANCHORING: Every \`prompt\` MUST explicitly name the category area being changed. For "${categoryName}": the prompt text must clearly reference "${categoryName.toLowerCase()}" (e.g., "Change the hairstyle to...", "Change the hair color to...", "Apply makeup...", "Change outfit to..."). The prompt must ONLY describe changes to the ${categoryName.toLowerCase()} — do NOT describe changes to unrelated areas (e.g., a Hairstyle prompt must NOT mention clothing, a Hair Color prompt must NOT change the outfit). If the transformation name uses a color or texture word (like "Charcoal", "Chocolate", "Platinum"), the prompt must make absolutely clear this applies to the ${categoryName.toLowerCase()}, not to clothing or other features.
- CRITICAL THUMBNAIL ANCHORING: The \`thumbnailPrompt\` must depict ONLY the ${categoryName.toLowerCase()} being changed — nothing else. Do NOT let color/texture words in the transformation name bleed into unrelated areas of the preview image. For example, if generating a "Dark Chocolate Texture" hairstyle thumbnail, the prompt must describe dark chocolate colored HAIR, not a dark brown shirt. Explicitly state what feature has the color/texture (e.g., "dark chocolate brown hair with textured layers" NOT just "dark chocolate texture").`;
}

function parseCategoryOptionsResult(content: string): GeneratedTransformation[] {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const parsed = JSON.parse(cleaned);
  const transformations = parsed.transformations || parsed;

  if (!Array.isArray(transformations)) {
    throw new Error('Expected transformations array');
  }

  return transformations.map((t: Record<string, unknown>) => ({
    id: String(t.id || `gen-${Math.random().toString(36).slice(2, 8)}`),
    name: String(t.name || 'Transformation'),
    prompt: String(t.prompt || ''),
    thumbnailPrompt: t.thumbnailPrompt ? String(t.thumbnailPrompt) : undefined,
    pitch: String(t.pitch || ''),
    intensity: typeof t.intensity === 'number' ? t.intensity : 0.65,
    negativePrompt: String(t.negativePrompt || 'deformed, distorted, bad quality, blurry'),
    icon: String(t.icon || '✨'),
  }));
}

/**
 * Phase 2: Generate options for a single category on-demand.
 * Returns an array of transformations for the specified category.
 */
export async function generateCategoryOptions(
  photoAnalysis: PhotoAnalysis,
  categoryName: string,
  categoryDescription: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any,
  options?: { currentLook?: string }
): Promise<GeneratedTransformation[]> {
  const prompt = buildCategoryOptionsPrompt(photoAnalysis, categoryName, categoryDescription, options);

  try {
    if (sogniClient?.getChatClient) {
      // Authenticated: direct SDK
      const rawClient = sogniClient.getChatClient();
      const messages = [
        { role: 'system' as const, content: 'You are a professional Hollywood stylist. Generate realistic, salon-quality transformation options in JSON format exactly as requested. Keep suggestions grounded and professional unless the client explicitly asks for fantasy or creative looks.' },
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

      return parseCategoryOptionsResult(fullContent);
    } else {
      // Demo: backend proxy
      const urls = getURLs();
      const response = await fetch(`${urls.apiUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a professional Hollywood stylist. Generate realistic, salon-quality transformation options in JSON format exactly as requested. Keep suggestions grounded and professional unless the client explicitly asks for fantasy or creative looks.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 4000,
          temperature: 0.8,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Category options generation failed: ${response.status}`);
      }

      // Read SSE stream with proper line buffering
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
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

      return parseCategoryOptionsResult(fullContent);
    }
  } catch (error) {
    console.error(`[TransformationService] Error generating options for "${categoryName}":`, error);
    // Return fallback transformations for matching category
    return getFallbackTransformationsForCategory(photoAnalysis, categoryName);
  }
}

/**
 * Find fallback transformations for a specific category name.
 */
function getFallbackTransformationsForCategory(
  photoAnalysis: PhotoAnalysis,
  categoryName: string
): GeneratedTransformation[] {
  const subject = photoAnalysis.subjectDescription || 'the person';
  const neg = 'deformed, distorted, bad quality, blurry';

  const fallbackMap: Record<string, GeneratedTransformation[]> = {
    'Hair Color': [
      { id: 'fallback-platinum-blonde', name: 'Platinum Blonde', prompt: `Change ${subject}'s hair to icy platinum blonde with a luminous shine while preserving facial features and identity`, pitch: 'Platinum is always a power move', intensity: 0.75, negativePrompt: neg, icon: '🤍' },
      { id: 'fallback-copper-auburn', name: 'Copper Auburn', prompt: `Change ${subject}'s hair to rich copper auburn with warm highlights while preserving facial features and identity`, pitch: 'This warm tone is going to make your eyes pop', intensity: 0.7, negativePrompt: neg, icon: '🔥' },
      { id: 'fallback-jet-black', name: 'Jet Black', prompt: `Change ${subject}'s hair to sleek jet black with a glossy mirror-like finish while preserving facial features and identity`, pitch: 'Dramatic, mysterious, absolutely iconic', intensity: 0.7, negativePrompt: neg, icon: '🖤' },
      { id: 'fallback-rose-gold', name: 'Rose Gold', prompt: `Change ${subject}'s hair to soft rose gold with pink undertones while preserving facial features and identity`, pitch: 'Soft, trendy, and totally you', intensity: 0.7, negativePrompt: neg, icon: '🌸' },
      { id: 'fallback-deep-burgundy', name: 'Deep Burgundy', prompt: `Change ${subject}'s hair to deep burgundy red with wine-toned highlights while preserving facial features and identity`, pitch: 'Rich and sultry — a head-turner for sure', intensity: 0.7, negativePrompt: neg, icon: '🍷' },
      { id: 'fallback-honey-balayage', name: 'Honey Balayage', prompt: `Change ${subject}'s hair to a sun-kissed honey balayage with caramel highlights blended through while preserving facial features and identity`, pitch: 'Sun-kissed without the sun damage — perfection', intensity: 0.7, negativePrompt: neg, icon: '🍯' },
    ],
    'Hairstyle': [
      { id: 'fallback-sleek-bob', name: 'Sleek Bob', prompt: `Give ${subject} a sharp chin-length sleek bob haircut with clean lines while preserving facial features and identity`, pitch: 'Clean lines, maximum impact', intensity: 0.75, negativePrompt: neg, icon: '✂️' },
      { id: 'fallback-beach-waves', name: 'Beach Waves', prompt: `Give ${subject} effortless tousled beach waves with natural volume while preserving facial features and identity`, pitch: 'That effortless "just left the beach" energy', intensity: 0.65, negativePrompt: neg, icon: '🌊' },
      { id: 'fallback-hollywood-curls', name: 'Hollywood Curls', prompt: `Give ${subject} glamorous old Hollywood finger waves and soft curls while preserving facial features and identity`, pitch: 'Classic Hollywood glamour never goes out of style', intensity: 0.7, negativePrompt: neg, icon: '🌟' },
      { id: 'fallback-pixie-cut', name: 'Pixie Cut', prompt: `Give ${subject} a chic modern pixie cut with textured layers while preserving facial features and identity`, pitch: 'Bold, confident, and absolutely fierce', intensity: 0.8, negativePrompt: neg, icon: '⚡' },
      { id: 'fallback-voluminous-blowout', name: 'Voluminous Blowout', prompt: `Give ${subject} a luxurious voluminous blowout with bouncy body and movement while preserving facial features and identity`, pitch: 'Big hair, big energy — let\'s go', intensity: 0.65, negativePrompt: neg, icon: '💨' },
      { id: 'fallback-braided-updo', name: 'Braided Updo', prompt: `Give ${subject} an elegant braided updo hairstyle with intricate woven details while preserving facial features and identity`, pitch: 'Elegance with an edge — this updo means business', intensity: 0.75, negativePrompt: neg, icon: '👸' },
    ],
    'Makeup Looks': [
      { id: 'fallback-smoky-eye', name: 'Smoky Eye', prompt: `Give ${subject} a dramatic smoky eye makeup look with blended dark eyeshadow while preserving facial features and identity`, pitch: 'The smoky eye is doing all the talking', intensity: 0.6, negativePrompt: neg, icon: '🖤' },
      { id: 'fallback-natural-glow', name: 'Natural Glow', prompt: `Give ${subject} a dewy natural glow makeup look with luminous skin and soft highlights while preserving facial features and identity`, pitch: 'Glowing skin is always in season', intensity: 0.55, negativePrompt: neg, icon: '✨' },
      { id: 'fallback-bold-red-lip', name: 'Bold Red Lip', prompt: `Give ${subject} a classic bold red lip with defined liner and flawless base while preserving facial features and identity`, pitch: 'A red lip is the ultimate confidence booster', intensity: 0.6, negativePrompt: neg, icon: '💋' },
      { id: 'fallback-glam-contour', name: 'Glam Contour', prompt: `Give ${subject} a full glam contoured makeup look with sculpted cheekbones and highlighted features while preserving facial features and identity`, pitch: 'Sculpted to perfection, darling', intensity: 0.65, negativePrompt: neg, icon: '💫' },
      { id: 'fallback-cat-eye', name: 'Cat Eye', prompt: `Give ${subject} a sharp winged cat eye liner look with dramatic lashes while preserving facial features and identity`, pitch: 'Sharp enough to cut glass — love it', intensity: 0.6, negativePrompt: neg, icon: '🐱' },
      { id: 'fallback-sunset-eyes', name: 'Sunset Eyes', prompt: `Give ${subject} a warm sunset-inspired eyeshadow look blending orange, pink, and gold tones while preserving facial features and identity`, pitch: 'Golden hour, but make it permanent', intensity: 0.6, negativePrompt: neg, icon: '🌅' },
    ],
    'Vibes & Aesthetic': [
      { id: 'fallback-red-carpet', name: 'Red Carpet Ready', prompt: `Give ${subject} a complete red carpet glamour transformation with elegant styling while preserving facial features and identity`, pitch: 'You\'re about to shut down every red carpet', intensity: 0.75, negativePrompt: neg, icon: '🏆' },
      { id: 'fallback-streetwear-cool', name: 'Streetwear Cool', prompt: `Give ${subject} an edgy modern streetwear-inspired look with urban styling while preserving facial features and identity`, pitch: 'Street style with main character energy', intensity: 0.7, negativePrompt: neg, icon: '🔥' },
      { id: 'fallback-ethereal', name: 'Ethereal Fantasy', prompt: `Give ${subject} an ethereal dreamy fantasy look with soft glowing features and romantic styling while preserving facial features and identity`, pitch: 'Giving fairy tale protagonist realness', intensity: 0.75, negativePrompt: neg, icon: '🧚' },
      { id: 'fallback-retro-vintage', name: 'Retro Vintage', prompt: `Give ${subject} a retro vintage 1960s inspired look with classic styling while preserving facial features and identity`, pitch: 'Timeless vintage — because classics never die', intensity: 0.7, negativePrompt: neg, icon: '📷' },
      { id: 'fallback-punk-edge', name: 'Punk Edge', prompt: `Give ${subject} a bold punk-inspired look with edgy dramatic styling while preserving facial features and identity`, pitch: 'Rules are meant to be broken, gorgeous', intensity: 0.8, negativePrompt: neg, icon: '🎸' },
      { id: 'fallback-90s-supermodel', name: '90s Supermodel', prompt: `Give ${subject} a 1990s supermodel look with brown liner, nude lip, and effortless blown-out hair while preserving facial features and identity`, pitch: 'Cindy Crawford called — she wants her vibe back', intensity: 0.7, negativePrompt: neg, icon: '🕶️' },
    ],
    'Skin & Glow': [
      { id: 'fallback-glass-skin', name: 'Glass Skin', prompt: `Give ${subject} a flawless dewy glass skin complexion with a luminous healthy glow while preserving facial features and identity`, pitch: 'That lit-from-within glow everyone is chasing', intensity: 0.5, negativePrompt: neg, icon: '💧' },
      { id: 'fallback-sun-kissed', name: 'Sun-Kissed Bronze', prompt: `Give ${subject} a warm sun-kissed bronzed complexion with natural freckles and golden glow while preserving facial features and identity`, pitch: 'Fresh off a Mediterranean vacation — no passport needed', intensity: 0.55, negativePrompt: neg, icon: '☀️' },
      { id: 'fallback-porcelain', name: 'Porcelain Finish', prompt: `Give ${subject} a smooth flawless porcelain skin finish with an even matte complexion while preserving facial features and identity`, pitch: 'Flawless doesn\'t even begin to cover it', intensity: 0.5, negativePrompt: neg, icon: '🤍' },
      { id: 'fallback-rosy-cheeks', name: 'Rosy Flush', prompt: `Give ${subject} a fresh rosy-cheeked flush with natural pink blushed cheeks and healthy radiance while preserving facial features and identity`, pitch: 'That just-pinched-your-cheeks freshness', intensity: 0.5, negativePrompt: neg, icon: '🌹' },
      { id: 'fallback-airbrushed', name: 'Airbrushed Glam', prompt: `Give ${subject} a smooth airbrushed glamour complexion with soft-focus skin and highlighted cheekbones while preserving facial features and identity`, pitch: 'Magazine cover ready — no retouching needed', intensity: 0.55, negativePrompt: neg, icon: '📸' },
      { id: 'fallback-natural-beauty', name: 'Natural Beauty', prompt: `Enhance ${subject}'s natural features with minimal subtle improvements for a fresh-faced clean beauty look while preserving facial features and identity`, pitch: 'Just you, but turned up to eleven', intensity: 0.45, negativePrompt: neg, icon: '🌿' },
    ],
    'Outfit & Style': [
      { id: 'fallback-leather-jacket', name: 'Leather Jacket', prompt: `Put ${subject} in a stylish black leather jacket with an effortlessly cool look while preserving facial features and identity`, pitch: 'Instant attitude upgrade — leather never lies', intensity: 0.7, negativePrompt: neg, icon: '🧥' },
      { id: 'fallback-elegant-blazer', name: 'Power Blazer', prompt: `Put ${subject} in a tailored power blazer with sharp shoulders and a polished professional look while preserving facial features and identity`, pitch: 'Boss energy — the boardroom won\'t know what hit it', intensity: 0.7, negativePrompt: neg, icon: '💼' },
      { id: 'fallback-streetwear-hoodie', name: 'Streetwear Hoodie', prompt: `Put ${subject} in a trendy oversized streetwear hoodie with an urban casual vibe while preserving facial features and identity`, pitch: 'Cozy meets cool — the best combo', intensity: 0.65, negativePrompt: neg, icon: '🔥' },
      { id: 'fallback-denim-jacket', name: 'Denim Jacket', prompt: `Put ${subject} in a classic denim jacket with a casual effortless style while preserving facial features and identity`, pitch: 'A denim jacket makes everything better — fact', intensity: 0.65, negativePrompt: neg, icon: '👖' },
      { id: 'fallback-evening-formal', name: 'Evening Formal', prompt: `Put ${subject} in stunning elegant formal evening wear with luxurious styling while preserving facial features and identity`, pitch: 'Red carpet ready from head to toe', intensity: 0.75, negativePrompt: neg, icon: '👔' },
      { id: 'fallback-casual-chic', name: 'Casual Chic', prompt: `Put ${subject} in a stylish casual-chic outfit with an effortlessly polished look while preserving facial features and identity`, pitch: 'Looking this good shouldn\'t be this easy', intensity: 0.65, negativePrompt: neg, icon: '✨' },
    ],
    'Accessories': [
      { id: 'fallback-statement-glasses', name: 'Statement Glasses', prompt: `Add stylish bold statement eyeglasses to ${subject} while preserving facial features and identity`, pitch: 'Smart AND stylish — the full package', intensity: 0.55, negativePrompt: neg, icon: '🤓' },
      { id: 'fallback-statement-earrings', name: 'Statement Earrings', prompt: `Add glamorous large statement earrings to ${subject} while preserving facial features and identity`, pitch: 'The earrings that steal the show', intensity: 0.55, negativePrompt: neg, icon: '💎' },
      { id: 'fallback-sunglasses', name: 'Designer Sunglasses', prompt: `Add sleek designer sunglasses to ${subject} while preserving facial features and identity`, pitch: 'Instant cool factor — just add shades', intensity: 0.55, negativePrompt: neg, icon: '😎' },
      { id: 'fallback-headband', name: 'Chic Headband', prompt: `Add a fashionable embellished headband to ${subject}'s hair while preserving facial features and identity`, pitch: 'A little detail that changes everything', intensity: 0.5, negativePrompt: neg, icon: '👑' },
      { id: 'fallback-choker', name: 'Elegant Choker', prompt: `Add an elegant choker necklace to ${subject} while preserving facial features and identity`, pitch: 'The perfect finishing touch', intensity: 0.5, negativePrompt: neg, icon: '📿' },
      { id: 'fallback-hat', name: 'Wide-Brim Hat', prompt: `Add a chic wide-brim hat to ${subject} for a fashionable sophisticated look while preserving facial features and identity`, pitch: 'A hat this good should be illegal', intensity: 0.6, negativePrompt: neg, icon: '🎩' },
    ],
    'Eye Color': [
      { id: 'fallback-emerald-eyes', name: 'Emerald Green', prompt: `Change ${subject}'s eye color to striking emerald green while preserving facial features and identity`, pitch: 'Green eyes that stop traffic', intensity: 0.55, negativePrompt: neg, icon: '💚' },
      { id: 'fallback-ice-blue', name: 'Ice Blue', prompt: `Change ${subject}'s eye color to piercing ice blue while preserving facial features and identity`, pitch: 'Those baby blues are going to be legendary', intensity: 0.55, negativePrompt: neg, icon: '💙' },
      { id: 'fallback-honey-amber', name: 'Honey Amber', prompt: `Change ${subject}'s eye color to warm honey amber with golden flecks while preserving facial features and identity`, pitch: 'Warm, golden, and absolutely mesmerizing', intensity: 0.55, negativePrompt: neg, icon: '🍯' },
      { id: 'fallback-violet-eyes', name: 'Violet', prompt: `Change ${subject}'s eye color to a rare striking violet purple while preserving facial features and identity`, pitch: 'Elizabeth Taylor energy — iconic', intensity: 0.55, negativePrompt: neg, icon: '💜' },
      { id: 'fallback-hazel-eyes', name: 'Warm Hazel', prompt: `Change ${subject}'s eye color to warm hazel with green and brown tones while preserving facial features and identity`, pitch: 'Hazel eyes that shift in every light', intensity: 0.5, negativePrompt: neg, icon: '🤎' },
      { id: 'fallback-steel-grey', name: 'Steel Grey', prompt: `Change ${subject}'s eye color to cool steel grey while preserving facial features and identity`, pitch: 'Mysterious and magnetic — impossible to look away', intensity: 0.55, negativePrompt: neg, icon: '🩶' },
    ],
    'Facial Hair': [
      { id: 'fallback-clean-shave', name: 'Clean Shave', prompt: `Give ${subject} a perfectly clean-shaven smooth face while preserving facial features and identity`, pitch: 'Fresh-faced and flawless', intensity: 0.6, negativePrompt: neg, icon: '✨' },
      { id: 'fallback-designer-stubble', name: 'Designer Stubble', prompt: `Give ${subject} perfectly groomed designer stubble with a rugged refined look while preserving facial features and identity`, pitch: 'That effortless five o\'clock shadow — chefs kiss', intensity: 0.55, negativePrompt: neg, icon: '😏' },
      { id: 'fallback-full-beard', name: 'Full Beard', prompt: `Give ${subject} a thick well-groomed full beard with clean edges while preserving facial features and identity`, pitch: 'A beard this good takes commitment — or just one click', intensity: 0.65, negativePrompt: neg, icon: '🧔' },
      { id: 'fallback-goatee', name: 'Classic Goatee', prompt: `Give ${subject} a sharp classic goatee with clean lines while preserving facial features and identity`, pitch: 'Focused, intentional, and sharp as ever', intensity: 0.6, negativePrompt: neg, icon: '🎯' },
      { id: 'fallback-mustache', name: 'Statement Mustache', prompt: `Give ${subject} a bold statement mustache with a classic vintage flair while preserving facial features and identity`, pitch: 'The mustache is making a comeback and you\'re leading the charge', intensity: 0.6, negativePrompt: neg, icon: '🥸' },
      { id: 'fallback-mutton-chops', name: 'Mutton Chops', prompt: `Give ${subject} bold retro mutton chop sideburns with a distinctive look while preserving facial features and identity`, pitch: 'Wolverine wishes he looked this good', intensity: 0.65, negativePrompt: neg, icon: '🐺' },
    ],
  };

  // Try exact match first, then case-insensitive partial match
  if (fallbackMap[categoryName]) {
    return fallbackMap[categoryName];
  }

  const lowerName = categoryName.toLowerCase();
  for (const [key, value] of Object.entries(fallbackMap)) {
    if (key.toLowerCase().includes(lowerName) || lowerName.includes(key.toLowerCase())) {
      return value;
    }
  }

  // Ultimate fallback: return Hair Color transformations
  return fallbackMap['Hair Color'];
}
