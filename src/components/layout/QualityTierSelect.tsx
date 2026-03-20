import { useApp } from '@/context/AppContext';
import {
  QWEN_LIGHTNING_MODEL_ID,
  QWEN_STANDARD_MODEL_ID,
  FLUX2_DEV_MODEL_ID,
} from '@/constants/settings';

const TIER_LABELS: Record<string, string> = {
  [QWEN_LIGHTNING_MODEL_ID]: 'Fast',
  [QWEN_STANDARD_MODEL_ID]: 'Standard',
  [FLUX2_DEV_MODEL_ID]: 'Pro',
};

const TIER_ORDER = [QWEN_LIGHTNING_MODEL_ID, QWEN_STANDARD_MODEL_ID, FLUX2_DEV_MODEL_ID];

function QualityTierSelect() {
  const { settings, updateSetting } = useApp();

  return (
    <select
      value={settings.defaultModel}
      onChange={(e) => updateSetting('defaultModel', e.target.value)}
      className="appearance-none rounded-lg border border-primary-400/[0.08] bg-surface-800/60 px-3 py-1 text-xs font-medium text-white/70 outline-none transition-colors hover:border-primary-400/20 focus:border-primary-400/30 cursor-pointer"
    >
      {TIER_ORDER.map((modelId) => (
        <option key={modelId} value={modelId}>
          {TIER_LABELS[modelId]}
        </option>
      ))}
    </select>
  );
}

export default QualityTierSelect;
