import Link from "next/link";
import styles from "./global-navigation.module.css";

export function GlobalNavigation() {
  return (
    <nav className={styles.navigation} aria-label="Navigation principale">
      <Link href="/">Terminal</Link>
      <Link href="/intelligence">Intelligence IA</Link>
      <Link href="/laboratoire">Laboratoire</Link>
    </nav>
  );
}
