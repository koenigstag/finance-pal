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
  common: {
    retry: 'Повторить',
    save: 'Сохранить',
    cancel: 'Отмена',
    back: 'Назад',
  },
  nav: {
    account: 'Аккаунт',
  },
  onboarding: {
    title: 'Добро пожаловать',
    description: 'Пара деталей перед началом.',
    submit: 'Продолжить',
  },
  profile: {
    displayName: 'Ваше имя',
    mainCurrency: 'Основная валюта',
    startDayOfWeek: 'Первый день недели',
    language: 'Язык',
  },
  settings: {
    title: 'Настройки',
    saved: 'Сохранено',
    profile: {
      title: 'Профиль',
      description: 'Язык также применяется к стартовым категориям в группах, созданных позже.',
    },
  },
  groups: {
    archived: 'в архиве',
    archivedNotice: 'Группа в архиве и доступна только для чтения.',
    readOnly: 'только чтение',
    roles: {
      owner: 'Владелец',
      admin: 'Администратор',
      member: 'Участник',
      viewer: 'Наблюдатель',
    },
    switcher: {
      label: 'Группы',
      placeholder: 'Выберите группу',
    },
    create: {
      title: 'Новая группа',
      description: 'Группы разделяют бюджеты, например личный и семейный.',
      firstDescription: 'Создайте первую группу, чтобы начать учёт. Позже ею можно будет поделиться.',
      name: 'Название',
      namePlaceholder: 'Личное',
      seed: 'Добавить стартовые счета и категории',
      seedDescription: 'Кошелек, карта и основные категории расходов и доходов.',
      submit: 'Создать группу',
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
