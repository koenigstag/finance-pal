import type { en } from './en';

// Same shape as `en` with any string values — see the comment there.
type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : Catalog<T[K]> };

export const ru: Catalog<typeof en> = {
  app: {
    name: 'Финансовый трекер',
    tagline: 'Личные и общие бюджеты',
  },
  auth: {
    email: 'Email',
    password: 'Пароль',
    logout: 'Выйти',
    signedInAs: 'Вы вошли как {{email}}',
    login: {
      title: 'Вход',
      submit: 'Войти',
      noAccount: 'Нет аккаунта?',
    },
    register: {
      title: 'Регистрация',
      submit: 'Зарегистрироваться',
      haveAccount: 'Уже есть аккаунт?',
    },
    errors: {
      invalidCredentials: 'Неверный email или пароль.',
      emailTaken: 'Аккаунт с таким email уже существует.',
    },
  },
  validation: {
    required: 'Обязательное поле',
    email: 'Введите корректный email',
    format: 'Неверный формат',
    minLength: 'Минимум {{min}} символов',
    maxLength: 'Максимум {{max}} символов',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
  },
};
