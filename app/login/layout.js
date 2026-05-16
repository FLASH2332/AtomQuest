export const metadata = {
  title: 'Sign In — AtomQuest',
  description: 'Sign in to the AtomQuest Goal Tracking Portal.',
};

/**
 * Layout wrapper for the /login route.
 * Purely here to attach metadata — the actual UI lives in page.js.
 *
 * @param {{ children: React.ReactNode }} props
 */
export default function LoginLayout({ children }) {
  return children;
}
