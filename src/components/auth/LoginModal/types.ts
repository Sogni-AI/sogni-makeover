export interface Step1Fields {
  username: string;
  email: string;
  subscribe: boolean;
  remember: boolean;
  referralCode: string;
}

export interface Step2Fields {
  password: string;
  passwordConfirm: string;
}

export interface SignupFields extends Step1Fields, Step2Fields {}

export type LoginModalMode = 'login' | 'signup';
