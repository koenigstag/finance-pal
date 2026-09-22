import { useTranslation } from 'react-i18next';
import { ImportFlow } from './import-flow';
import { useImportOneMoney } from './queries';

/** Picking a 1Money backup and what came of it: the last step of the import flow. */
export function OneMoneyImport({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const importer = useImportOneMoney();
  return (
    <ImportFlow
      steps={[t('data.import.oneMoney.step1'), t('data.import.oneMoney.step2'), t('data.import.oneMoney.step3')]}
      fileLabel={t('data.import.oneMoney.file')}
      importer={importer}
      onDone={onDone}
    />
  );
}
