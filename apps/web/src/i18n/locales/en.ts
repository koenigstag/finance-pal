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
  common: {
    retry: 'Try again',
    save: 'Save',
    cancel: 'Cancel',
    back: 'Back',
  },
  nav: {
    account: 'Account',
  },
  onboarding: {
    title: 'Welcome',
    description: 'A few details before you start.',
    submit: 'Continue',
  },
  profile: {
    displayName: 'Your name',
    mainCurrency: 'Main currency',
    startDayOfWeek: 'Week starts on',
    language: 'Language',
  },
  settings: {
    title: 'Settings',
    saved: 'Saved',
    profile: {
      title: 'Profile',
      description: 'The language also applies to starter categories in groups you create later.',
    },
  },
  groups: {
    archived: 'archived',
    archivedNotice: 'This group is archived and read-only.',
    readOnly: 'read-only',
    roles: {
      owner: 'Owner',
      admin: 'Admin',
      member: 'Member',
      viewer: 'Viewer',
    },
    switcher: {
      label: 'Groups',
      placeholder: 'Choose a group',
    },
    create: {
      title: 'New group',
      description: 'Groups keep separate budgets apart, like personal and family.',
      firstDescription: 'Create your first group to start tracking money. You can share it with others later.',
      name: 'Name',
      namePlaceholder: 'Personal',
      seed: 'Add starter accounts and categories',
      seedDescription: 'A wallet, a card and common expense and income categories.',
      submit: 'Create group',
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
