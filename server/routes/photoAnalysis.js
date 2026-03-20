import express from 'express';
import { analyzePhotoSubject, analyzeImageVision } from '../services/sogni.js';

const router = express.Router();

// Origin validation: only allow *.sogni.ai (block missing origin)
function validateOrigin(req, res, next) {
  const origin = req.get('origin') || req.get('referer') || '';
  if (!origin || !origin.match(/^https?:\/\/[^/]*\.sogni\.ai(:\d+)?(\/|$)/)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.use(validateOrigin);

router.post('/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 must be a non-empty string' });
    }

    // Ensure data URI format
    const dataUri = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const result = await analyzePhotoSubject(dataUri);
    res.json(result);
  } catch (error) {
    console.error('[PhotoAnalysis] Error:', error);
    res.json({
      subjectCount: 1,
      subjectDescription: 'the person',
      perceivedGender: null,
      genderConfidence: 'low',
      estimatedAgeRange: null,
      features: {},
      stylistNotes: '',
    });
  }
});

// Vision analysis proxy for demo users (used by compare_before_after, analyze_result tools)
router.post('/vision', async (req, res) => {
  try {
    const { imageBase64, systemPrompt } = req.body;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 must be a non-empty string' });
    }
    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return res.status(400).json({ error: 'systemPrompt must be a non-empty string' });
    }
    if (systemPrompt.length > 20000) {
      return res.status(400).json({ error: 'systemPrompt must not exceed 20000 characters' });
    }

    const dataUri = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const result = await analyzeImageVision(dataUri, systemPrompt);
    res.json({ content: result });
  } catch (error) {
    console.error('[Vision] Error:', error);
    res.status(500).json({ error: error.message || 'Vision analysis failed' });
  }
});

export default router;
