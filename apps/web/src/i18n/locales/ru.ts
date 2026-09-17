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
    delete: 'Удалить',
  },
  nav: {
    account: 'Аккаунт',
    home: 'Главная',
    accounts: 'Счета',
    transactions: 'Операции',
  },
  home: {
    recent: 'Последние операции',
    seeAll: 'Все',
  },
  accounts: {
    title: 'Счета',
    new: 'Новый счёт',
    edit: 'Изменить счёт',
    name: 'Название',
    type: 'Тип',
    currency: 'Валюта',
    includedInBalance: 'Учитывать в общем балансе',
    includedInBalanceDescription: 'Отключите для счетов, которые нужно только отслеживать, например кредита.',
    excluded: 'не в общем балансе',
    planned: 'С учётом плана: {{amount}}',
    types: {
      regular: 'Обычный',
      debt: 'Долг',
      savings: 'Накопления',
    },
    empty: {
      title: 'Счетов пока нет',
      description: 'Добавьте счёт, чтобы записывать операции.',
    },
  },
  transactions: {
    title: 'Операции',
    new: 'Добавить операцию',
    edit: 'Изменить операцию',
    amount: 'Сумма',
    account: 'Счёт',
    fromAccount: 'Со счёта',
    toAccount: 'На счёт',
    chooseAccount: 'Выберите счёт',
    destAmount: 'Сумма зачисления',
    category: 'Категория',
    noCategory: 'Без категории',
    date: 'Дата',
    note: 'Заметка',
    recurring: 'Повторяющаяся',
    planned: 'Запланировано',
    customized: 'Изменено',
    loadMore: 'Загрузить ещё',
    occurrenceNotice: 'Часть повторяющейся серии. Изменения затронут только эту дату.',
    types: {
      expense: 'Расход',
      income: 'Доход',
      transfer: 'Перевод',
    },
    errors: {
      sameAccount: 'Выберите другой счёт',
    },
    deleteConfirm: {
      title: 'Удалить операцию?',
      description: 'Балансы счетов будут пересчитаны.',
      occurrence: 'Будет пропущена только эта дата, остальная серия сохранится.',
    },
    filters: {
      search: 'Поиск по заметкам',
      type: 'Тип',
      allAccounts: 'Все счета',
      allTypes: 'Все типы',
      allCategories: 'Все категории',
      previousMonth: 'Предыдущий месяц',
      nextMonth: 'Следующий месяц',
    },
    empty: {
      title: 'Операций нет',
      description: 'За этот месяц с такими фильтрами ничего не найдено.',
    },
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
    appearance: {
      title: 'Оформление',
      description: 'Действует только на этом устройстве.',
      system: 'Как в системе',
      light: 'Светлая',
      dark: 'Тёмная',
    },
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
    amount: 'Введите сумму больше нуля',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
  },
};
