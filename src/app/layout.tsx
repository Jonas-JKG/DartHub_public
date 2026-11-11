import {LanguageInit} from '../components/LanguagePreferences';
import AccessBoundary from '../components/AccessBoundary';
import SocialPresence from '../components/SocialPresence';
import type { Metadata } from 'next';
import './globals.css';
import './design.css';
import DevicePreferences from '../components/DevicePreferences';
export const metadata: Metadata = { title: 'Dartbracket', description: 'Dartturniere organisieren, Legs eintragen und gemeinsam live verfolgen.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="de" data-theme="dark" suppressHydrationWarning><body><LanguageInit/><DevicePreferences/><AccessBoundary><SocialPresence/>{children}</AccessBoundary></body></html>;
}
