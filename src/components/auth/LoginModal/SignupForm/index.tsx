import { useCallback, useState } from 'react';
import { Step1Fields, Step2Fields } from '../types';
import { getReferralSource } from '@/utils/referralTracking';
import Step1 from './Step1';
import Step2 from './Step2';
import Step3 from './Step3';
import Step4 from './Step4';

interface Props {
  onLogin: () => void;
  onClose: () => void;
  onSignupComplete?: () => void;
}

function SignupForm({ onLogin, onClose, onSignupComplete }: Props) {
  const [step1, setStep1] = useState<Step1Fields>(() => ({
    username: '',
    email: '',
    subscribe: false,
    remember: true,
    referralCode: getReferralSource() || 'MAKEOVER'
  }));

  const [step2, setStep2] = useState<Step2Fields>({
    password: '',
    passwordConfirm: '',
  });

  const [step, setStep] = useState(1);

  const handleStep1Complete = useCallback((fields: Step1Fields) => {
    setStep1(fields);
    setStep(2);
  }, []);

  const handleStep2Complete = useCallback((fields: Step2Fields) => {
    setStep2(fields);
    setStep(3);
  }, []);

  const handleStep3Complete = useCallback(() => {
    setStep(4);
  }, []);

  const handleReturn = useCallback(() => {
    setStep((prevStep) => Math.max(1, prevStep - 1));
  }, []);

  switch (step) {
    case 1:
      return <Step1 defaults={step1} onLogin={onLogin} onContinue={handleStep1Complete} />;
    case 2:
      return (
        <Step2
          onContinue={handleStep2Complete}
          onReturn={handleReturn}
          initialState={step2}
          step1={step1}
        />
      );
    case 3:
      return (
        <Step3 step1={step1} step2={step2} onReturn={handleReturn} onContinue={handleStep3Complete} />
      );
    case 4:
      return <Step4 onClose={onClose} onSignupComplete={onSignupComplete} />;
    default:
      return null;
  }
}

export default SignupForm;
