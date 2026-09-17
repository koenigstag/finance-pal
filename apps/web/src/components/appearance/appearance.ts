import {
  BabyIcon,
  BanknoteIcon,
  BeerIcon,
  BikeIcon,
  BitcoinIcon,
  BookIcon,
  BriefcaseIcon,
  Building2Icon,
  BusIcon,
  CarIcon,
  CatIcon,
  ChartCandlestickIcon,
  CoffeeIcon,
  CoinsIcon,
  CreditCardIcon,
  DogIcon,
  DropletsIcon,
  DumbbellIcon,
  EllipsisIcon,
  FilmIcon,
  FlameIcon,
  FuelIcon,
  Gamepad2Icon,
  GemIcon,
  GiftIcon,
  GlassesIcon,
  GraduationCapIcon,
  HammerIcon,
  HandCoinsIcon,
  HandshakeIcon,
  HeartIcon,
  HouseIcon,
  KeyIcon,
  LandmarkIcon,
  LaptopIcon,
  MusicIcon,
  PaletteIcon,
  PawPrintIcon,
  PiggyBankIcon,
  PillIcon,
  PizzaIcon,
  PlaneIcon,
  ReceiptIcon,
  ScissorsIcon,
  ShieldIcon,
  ShirtIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  SparklesIcon,
  StethoscopeIcon,
  TicketIcon,
  TrainFrontIcon,
  TreePalmIcon,
  TrendingUpIcon,
  TvIcon,
  UsersIcon,
  UtensilsIcon,
  VaultIcon,
  WalletIcon,
  WifiIcon,
  WrenchIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icons an account or a category can have, by the name stored in their icon column. Some names
 * predate lucide and come from the starter templates ("bolt", "home", "dots-horizontal", "card").
 */
export const ICONS: Readonly<Record<string, LucideIcon>> = {
  wallet: WalletIcon,
  card: CreditCardIcon,
  landmark: LandmarkIcon,
  bank: Building2Icon,
  banknote: BanknoteIcon,
  coins: CoinsIcon,
  'piggy-bank': PiggyBankIcon,
  vault: VaultIcon,
  'hand-coins': HandCoinsIcon,
  handshake: HandshakeIcon,
  'chart-candlestick': ChartCandlestickIcon,
  bitcoin: BitcoinIcon,
  gem: GemIcon,
  'shopping-cart': ShoppingCartIcon,
  coffee: CoffeeIcon,
  car: CarIcon,
  home: HouseIcon,
  bolt: ZapIcon,
  heart: HeartIcon,
  film: FilmIcon,
  book: BookIcon,
  bag: ShoppingBagIcon,
  key: KeyIcon,
  briefcase: BriefcaseIcon,
  laptop: LaptopIcon,
  gift: GiftIcon,
  'trending-up': TrendingUpIcon,
  utensils: UtensilsIcon,
  pizza: PizzaIcon,
  beer: BeerIcon,
  shirt: ShirtIcon,
  glasses: GlassesIcon,
  scissors: ScissorsIcon,
  sparkles: SparklesIcon,
  bus: BusIcon,
  train: TrainFrontIcon,
  fuel: FuelIcon,
  bike: BikeIcon,
  plane: PlaneIcon,
  'tree-palm': TreePalmIcon,
  ticket: TicketIcon,
  gamepad: Gamepad2Icon,
  music: MusicIcon,
  palette: PaletteIcon,
  tv: TvIcon,
  smartphone: SmartphoneIcon,
  wifi: WifiIcon,
  droplets: DropletsIcon,
  flame: FlameIcon,
  wrench: WrenchIcon,
  hammer: HammerIcon,
  pill: PillIcon,
  stethoscope: StethoscopeIcon,
  dumbbell: DumbbellIcon,
  shield: ShieldIcon,
  'graduation-cap': GraduationCapIcon,
  baby: BabyIcon,
  users: UsersIcon,
  'paw-print': PawPrintIcon,
  dog: DogIcon,
  cat: CatIcon,
  receipt: ReceiptIcon,
  'credit-card': CreditCardIcon,
  'dots-horizontal': EllipsisIcon,
};

const MONEY_ICONS = [
  'wallet', 'card', 'landmark', 'bank', 'banknote', 'coins', 'piggy-bank', 'vault', 'hand-coins',
  'handshake', 'chart-candlestick', 'bitcoin', 'gem',
];

// Picker order. Accounts lead with places money is kept; categories with what it's spent on and
// earned from. Both offer every icon, only the order differs.
export const CATEGORY_ICON_NAMES = [
  ...Object.keys(ICONS).filter((name) => !MONEY_ICONS.includes(name) && name !== 'credit-card'),
  ...MONEY_ICONS,
];
export const ACCOUNT_ICON_NAMES = [
  ...MONEY_ICONS,
  ...Object.keys(ICONS).filter((name) => !MONEY_ICONS.includes(name) && name !== 'credit-card'),
];

/** The palette: the starter templates' Material colors, plus a few to fill gaps. */
export const COLORS = [
  '#F44336',
  '#E91E63',
  '#9C27B0',
  '#673AB7',
  '#3F51B5',
  '#2196F3',
  '#00BCD4',
  '#009688',
  '#4CAF50',
  '#8BC34A',
  '#FFC107',
  '#FF9800',
  '#FF5722',
  '#795548',
  '#607D8B',
  '#9E9E9E',
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The color to render, or null for one that isn't a plain #RRGGBB (and so can't be tinted). */
export function validColor(color: string | null | undefined): string | null {
  return color && HEX_COLOR.test(color) ? color : null;
}

/**
 * A suggested look for something new: its parent's (a subcategory's parent category), or the next
 * palette color after its existing siblings.
 */
export function defaultAppearance(
  parent: { icon: string | null; color: string | null } | undefined,
  siblingCount: number,
  fallbackIcon: string | null = null,
): { icon: string | null; color: string } {
  return {
    icon: parent?.icon ?? fallbackIcon,
    color: validColor(parent?.color) ?? COLORS[siblingCount % COLORS.length],
  };
}
