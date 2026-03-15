import { useCallback, useReducer, useRef } from 'react';

export interface ErrorData {
  code: number;
  message: string;
}

interface Form<F, R> {
  fields: F;
  status: 'idle' | 'validating' | 'submitting' | 'submitted' | 'error';
  result: R | null;
  fieldErrors: Record<string, string>;
  error: ErrorData | null;
  isLoading: boolean;
  isValid: boolean | null;
}

type Action<F, R> =
  | { type: 'change'; payload: Partial<F> }
  | { type: 'validate' }
  | { type: 'validation/success' }
  | { type: 'validation/error'; payload: Record<string, string> }
  | { type: 'submit' }
  | { type: 'submit/success'; payload: R }
  | { type: 'submit/error'; payload: ErrorData }
  | { type: 'clear_result' };

function reducer<F = unknown, R = unknown>(state: Form<F, R>, action: Action<F, R>): Form<F, R> {
  switch (action.type) {
    case 'change': {
      const changedKeys = Object.keys(action.payload as Record<string, unknown>);
      const fieldErrors = { ...state.fieldErrors };
      changedKeys.forEach(key => {
        delete fieldErrors[key];
      });
      return {
        ...state,
        fields: {
          ...state.fields,
          ...action.payload
        },
        isValid: Object.keys(fieldErrors).length ? false : null,
        fieldErrors
      };
    }
    case 'validate':
      return {
        ...state,
        status: 'validating',
        error: null,
        isValid: null,
        isLoading: true
      };
    case 'validation/success':
      return {
        ...state,
        fieldErrors: {},
        status: 'idle',
        isValid: true,
        isLoading: false
      };
    case 'validation/error':
      return {
        ...state,
        fieldErrors: action.payload,
        status: 'error',
        isValid: false,
        isLoading: false
      };
    case 'submit':
      return {
        ...state,
        result: null,
        status: 'submitting',
        fieldErrors: {},
        error: null,
        isLoading: true
      };
    case 'submit/success':
      return {
        ...state,
        status: 'submitted',
        result: action.payload,
        isLoading: false
      };
    case 'submit/error':
      return {
        ...state,
        status: 'error',
        error: action.payload,
        isLoading: false
      };
    case 'clear_result':
      return {
        ...state,
        result: null,
        status: 'idle',
        error: null
      };
    default:
      return state;
  }
}

type Validator<F> = (fields: F) => Promise<Record<string, string>>;

export type FormContext<F, R> = Form<F, R> & {
  handleChange: (delta: Partial<F>) => void;
  handleSubmit: (fields?: Partial<F>) => Promise<void>;
  handleFieldChange: (value: unknown, name: string) => void;
  handleFormSubmit: (e?: React.FormEvent<HTMLFormElement>) => void;
  handleClearResult: () => void;
};

function useForm<F, R>(
  initialState: F,
  formAction: (form: F) => Promise<R>,
  validate?: Validator<F>
): FormContext<F, R> {
  const isSubmittingRef = useRef(false);
  const [form, dispatch] = useReducer(reducer<F, R>, {
    fields: initialState,
    status: 'idle',
    result: null,
    fieldErrors: {},
    error: null,
    isValid: null,
    isLoading: false
  } as Form<F, R>);

  const handleChange = useCallback((delta: Partial<F>) => {
    dispatch({ type: 'change', payload: delta });
  }, []);

  const handleSubmit = useCallback(
    async (fields?: Partial<F>) => {
      if (isSubmittingRef.current) {
        return;
      }
      isSubmittingRef.current = true;
      if (fields) {
        dispatch({ type: 'change', payload: fields });
      }
      try {
        if (validate) {
          dispatch({ type: 'validate' });
          const errors = await validate(form.fields);
          if (Object.keys(errors).length) {
            dispatch({ type: 'validation/error', payload: errors });
            isSubmittingRef.current = false;
            return;
          }
          dispatch({ type: 'validation/success' });
        }
        dispatch({ type: 'submit' });
        const payload = fields ? { ...form.fields, ...fields } : form.fields;
        const result = await formAction(payload);
        isSubmittingRef.current = false;
        dispatch({ type: 'submit/success', payload: result });
      } catch (error: unknown) {
        console.error('Failed to submit form', error);
        isSubmittingRef.current = false;
        const err = error as { code?: number; errorCode?: number; message?: string; payload?: { errorCode?: number; message?: string } };
        const errorCode = err.payload?.errorCode || err.code || err.errorCode || 0;
        const errorMessage = err.message || err.payload?.message || 'An error occurred';
        dispatch({
          type: 'submit/error',
          payload: { code: errorCode, message: errorMessage }
        });
      }
    },
    [form.fields, formAction, validate]
  );

  const handleFieldChange = useCallback((value: unknown, name: string) => {
    dispatch({ type: 'change', payload: { [name]: value } as Partial<F> });
  }, []);

  const handleFormSubmit = useCallback(
    (e?: React.FormEvent<HTMLFormElement>) => {
      if (e) {
        e.preventDefault();
      }
      handleSubmit();
    },
    [handleSubmit]
  );

  const handleClearResult = useCallback(() => {
    dispatch({ type: 'clear_result' });
  }, []);

  return {
    ...form,
    handleChange,
    handleSubmit,
    handleFieldChange,
    handleFormSubmit,
    handleClearResult
  };
}

export default useForm;
