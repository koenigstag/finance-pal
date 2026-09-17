import { LogOutIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStores } from '@/stores/stores-context';
import { logout } from './logout';

/** The signed-in account on the settings page, with logging out behind a confirmation. */
export const LogoutCard = observer(function LogoutCard() {
  const { t } = useTranslation();
  const { session } = useStores();
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.account.title')}</CardTitle>
        <CardDescription className="truncate">{session.session?.user.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full text-destructive" onClick={() => setConfirming(true)}>
          <LogOutIcon />
          {t('auth.logout')}
        </Button>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('auth.logoutConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('auth.logoutConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void logout()}>
              {t('auth.logout')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
});
