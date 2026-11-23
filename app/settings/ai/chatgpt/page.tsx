import Image from 'next/image';
import Link from 'next/link';
import { Disclosure } from '@/components/disclosure';
import { ChatGptAccountPanel } from '@/components/settings/chatgpt-account-panel';
import { ChatGptSynthesisPanel } from '@/components/settings/chatgpt-synthesis-panel';
import { SETTINGS_SECONDARY_BUTTON_CLASS, SettingsSectionIntro } from '@/components/settings/settings-ui';
import styles from './page.module.css';

export default function ChatGptProductPage() {
    return <div className={styles.page}>
        <header className={styles.header}>
            <div className={styles.identity}>
                <Image className={styles.logo} src="/brand/openai/chatgpt-mark.png" alt="Logo OpenAI" width={40} height={40} unoptimized />
                <div>
                    <SettingsSectionIntro
                        title="OpenAI · ChatGPT"
                        description="La prova usa dati dimostrativi e richiede un accesso dedicato e la scelta del modello OpenAI."
                    />
                    <p className="type-meta">Servizio esterno · abbonamento personale ChatGPT.</p>
                </div>
            </div>
            <Link href="/settings/ai/fabric" prefetch={false} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} ${styles.returnLink}`}>Torna a Intelligence Fabric</Link>
        </header>
        <ChatGptSynthesisPanel />
        <Disclosure title="Controllo account ChatGPT · separato dalla prova" headingLevel={3} className={styles.account}>
            <div className={styles.accountBody}>
                <p>Per la prova serve l’accesso dedicato. Da qui puoi controllare collegamento, modelli e utilizzo dell’account.</p>
                <ChatGptAccountPanel primary={false} />
            </div>
        </Disclosure>
    </div>;
}
