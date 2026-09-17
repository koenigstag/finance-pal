import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { THEME_PREFERENCES, parseThemePreference } from '@/stores/theme-store';
import { useStores } from '@/stores/stores-context';

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/** Theme choice for the settings page. Takes effect immediately; there's nothing to save. */
export const AppearanceCard = observer(function AppearanceCard() {
  const { t } = useTranslation();
  const { theme } = useStores();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance.title')}</CardTitle>
        <CardDescription>{t('settings.appearance.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          value={theme.preference}
          aria-label={t('settings.appearance.title')}
          onValueChange={(value) => {
            // Deselecting the active item reports ''; one option is always chosen.
            if (value) {
              theme.setPreference(parseThemePreference(value));
            }
          }}
        >
          {THEME_PREFERENCES.map((option) => {
            const Icon = ICONS[option];
            return (
              <ToggleGroupItem key={option} value={option} className="flex-1">
                <Icon />
                {t(`settings.appearance.${option}`)}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </CardContent>
    </Card>
  );
});
