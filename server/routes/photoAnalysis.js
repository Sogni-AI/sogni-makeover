import express from 'express';
import { analyzePhotoSubject } from '../services/sogni.js';

const router = express.Router();

// Origin validation: only allow *.sogni.ai
function validateOrigin(req, res, next) {
  const origin = req.get('origin') || '';
  if (origin && !origin.match(/\.sogni\.ai(:\d+)?$/)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.use(validateOrigin);

router.post('/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
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

export default router;
