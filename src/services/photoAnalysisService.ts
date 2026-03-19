import type { PhotoAnalysis } from '@/types/chat';
import { analyzePhoto as analyzePhotoApi } from '@/services/api';

const analysisCache = new Map<string, PhotoAnalysis>();

const FALLBACK_ANALYSIS: PhotoAnalysis = {
  subjectCount: 1,
  subjectDescription: 'the person',
  perceivedGender: null,
  genderConfidence: 'low',
  estimatedAgeRange: null,
  features: {},
  stylistNotes: '',
};

const ANALYSIS_SYSTEM_PROMPT = `You are an eccentric legendary Hollywood stylist to the stars. Analyze the portrait photo as if the subject is the client sitting in your studio chair, ready to upgrade their look.

Return JSON with your professional assessment:
{
  "subjectCount": 1,
  "subjectDescription": "a young woman with long dark curly hair",
  "perceivedGender": "female",
  "genderConfidence": "high",
  "estimatedAgeRange": "25-30",
  "features": {
    "hairColor": "dark brown",
    "hairStyle": "long, curly",
    "hairLength": "long",
    "skinTone": "medium warm",
    "facialHair": null,
    "glasses": false,
    "distinctiveFeatures": ["killer cheekbones", "full lips"]
  },
  "stylistNotes": "That bone structure is begging for a dramatic side part. The warm skin tone opens up the whole copper-to-auburn palette."
}

Focus on: apparent gender, age range, hair (color/length/style), skin tone, facial hair, glasses, distinctive visible features. Do NOT mention clothing or background. The stylistNotes should be your candid professional read — what excites you about this client's potential.`;

/**
 * Resize an image to max 512px for efficient LLM analysis.
 */
async function resizeImageForAnalysis(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxDim = 512;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas context'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

function parseAnalysisResponse(content: string): PhotoAnalysis {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const parsed = JSON.parse(cleaned);
  return {
    subjectCount: typeof parsed.subjectCount === 'number' ? parsed.subjectCount : 1,
    subjectDescription: typeof parsed.subjectDescription === 'string' ? parsed.subjectDescription : 'the person',
    perceivedGender: ['male', 'female'].includes(parsed.perceivedGender) ? parsed.perceivedGender : null,
    genderConfidence: ['high', 'medium', 'low'].includes(parsed.genderConfidence) ? parsed.genderConfidence : 'low',
    estimatedAgeRange: typeof parsed.estimatedAgeRange === 'string' ? parsed.estimatedAgeRange : null,
    features: parsed.features || {},
    stylistNotes: typeof parsed.stylistNotes === 'string' ? parsed.stylistNotes : '',
  };
}

/**
 * Analyze a photo using the LLM vision model.
 * Authenticated users call the SDK directly; demo users go through the backend proxy.
 */
export async function analyzePhotoSubject(
  imageUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any
): Promise<PhotoAnalysis> {
  // Check cache
  const cached = analysisCache.get(imageUrl);
  if (cached) return cached;

  try {
    const dataUri = await resizeImageForAnalysis(imageUrl);

    let result: PhotoAnalysis;

    if (sogniClient?.getChatClient) {
      // Authenticated path: direct SDK call
      const rawClient = sogniClient.getChatClient();
      const messages = [
        { role: 'system' as const, content: ANALYSIS_SYSTEM_PROMPT },
        {
          role: 'user' as const,
          content: [
            { type: 'image_url' as const, image_url: { url: dataUri } },
            { type: 'text' as const, text: 'Describe the main subject of this portrait.' },
          ],
        },
      ];

      let fullContent = '';
      const stream = await rawClient.chat.completions.create({
        model: 'qwen3.5-35b-a3b-gguf-q4km',
        messages,
        stream: true,
        tokenType: 'spark',
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 300,
        think: false,
      });

      // SDK ChatStream yields { content, tool_calls, ... } directly (not OpenAI choices format)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of stream as AsyncIterable<{ content?: string }>) {
        if (chunk.content) fullContent += chunk.content;
      }

      result = parseAnalysisResponse(fullContent);
    } else {
      // Demo path: backend proxy
      const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
      result = await analyzePhotoApi(base64);
    }

    analysisCache.set(imageUrl, result);
    return result;
  } catch (error) {
    console.error('[PhotoAnalysis] Error:', error);
    return FALLBACK_ANALYSIS;
  }
}

export { FALLBACK_ANALYSIS };
