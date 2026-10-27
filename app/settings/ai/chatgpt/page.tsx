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
                <SettingsSectionIntro
                    kicker="Servizio esterno · abbonamento personale ChatGPT."
                    title="OpenAI · ChatGPT"
                    description="Account collegato non significa modello pronto. La prova richiede un accesso dedicato e una scelta manuale; non usa i modelli locali."
                />
            </div>
            <Link href="/settings/ai/fabric" prefetch={false} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} ${styles.returnLink}`}>Torna a Intelligence Fabric</Link>
        </header>
        <ChatGptSynthesisPanel />
        <Disclosure title="Controllo account ChatGPT · separato dalla prova">
            <div className={styles.accountBody}>
                <p>Qui controlli collegamento, modelli e utilizzo dell’account. Questo accesso non abilita la prova né le funzioni cliniche.</p>
                <ChatGptAccountPanel />
            </div>
        </Disclosure>
    </div>;
}
