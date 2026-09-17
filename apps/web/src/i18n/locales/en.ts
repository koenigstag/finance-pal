// The English catalog is the source of truth for keys: ru.ts is type-checked against its shape,
// so a key added here and forgotten there fails the build instead of rendering a raw key.
export const en = {
  app: {
    name: 'Finance Tracker',
    tagline: 'Personal and shared budgets',
  },
  auth: {
    email: 'Email',
    password: 'Password',
    logout: 'Log out',
    signedInAs: 'Signed in as {{email}}',
    login: {
      title: 'Log in',
      submit: 'Log in',
      noAccount: "Don't have an account?",
    },
    register: {
      title: 'Create account',
      submit: 'Create account',
      haveAccount: 'Already have an account?',
    },
    errors: {
      invalidCredentials: 'Wrong email or password.',
      emailTaken: 'An account with this email already exists.',
    },
  },
  validation: {
    required: 'Required',
    email: 'Enter a valid email address',
    format: 'Invalid format',
    minLength: 'At least {{min}} characters',
    maxLength: 'At most {{max}} characters',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
  },
} as const;
