import type { GeneratedCategory, PhotoAnalysis } from '@/types/chat';
import { getURLs } from '@/config/urls';

const TRANSFORMATION_GENERATION_PROMPT = `Based on this client's features and what they're looking for, generate 8-12 transformation options organized into 2-4 categories.

Client: {photoAnalysis}
They want: {intent}

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
  ]
}

Rules:
- Write prompts with the actual subject description baked in (not generic "the person")
- Set intensity (denoising strength) appropriate to how dramatic the change is: subtle 0.5-0.6, moderate 0.6-0.75, dramatic 0.75-0.95
- Each pitch is a one-liner the stylist would say to sell the look — cheeky, confident, fun
- Categories should be relevant to what the client asked for
- Keep negative prompts consistent: "deformed, distorted, bad quality, blurry"
- Generate unique IDs for each transformation (use descriptive slugs like "copper-auburn-hair")
- Include emoji icons that match each transformation`;

function buildGenerationPrompt(photoAnalysis: PhotoAnalysis, intent: string): string {
  return TRANSFORMATION_GENERATION_PROMPT
    .replace('{photoAnalysis}', JSON.stringify(photoAnalysis, null, 2))
    .replace('{intent}', intent);
}

function parseCategories(content: string): GeneratedCategory[] {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const parsed = JSON.parse(cleaned);
  const categories = parsed.categories || parsed;

  if (!Array.isArray(categories)) {
    throw new Error('Expected categories array');
  }

  return categories.map((cat: Record<string, unknown>) => ({
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
}

/**
 * Generate personalized transformation options via LLM.
 */
export async function generateTransformations(
  photoAnalysis: PhotoAnalysis,
  intent: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any
): Promise<GeneratedCategory[]> {
  const prompt = buildGenerationPrompt(photoAnalysis, intent);

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
        max_tokens: 2000,
        think: false,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      }

      return parseCategories(fullContent);
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

      return parseCategories(fullContent);
    }
  } catch (error) {
    console.error('[TransformationService] Error generating transformations:', error);
    // Return a fallback set
    return [{
      name: 'Quick Looks',
      icon: '✨',
      transformations: [
        {
          id: 'fallback-glam',
          name: 'Glamorous Makeover',
          prompt: `Give ${photoAnalysis.subjectDescription} a glamorous red carpet makeover while preserving facial features and identity`,
          pitch: 'Let\'s start with a classic glow-up',
          intensity: 0.7,
          negativePrompt: 'deformed, distorted, bad quality, blurry',
          icon: '💫',
        },
        {
          id: 'fallback-hair',
          name: 'Bold Hair Change',
          prompt: `Change ${photoAnalysis.subjectDescription}'s hair to a completely new dramatic style while preserving facial features and identity`,
          pitch: 'Nothing says transformation like a new do',
          intensity: 0.75,
          negativePrompt: 'deformed, distorted, bad quality, blurry',
          icon: '💇',
        },
      ],
    }];
  }
}
