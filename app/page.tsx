import { Demo } from '@/src/components/landing/Demo';
import { Faq } from '@/src/components/landing/Faq';
import { Footer } from '@/src/components/landing/Footer';
import { Hero } from '@/src/components/landing/Hero';
import { HowItWorks } from '@/src/components/landing/HowItWorks';
import { Nav } from '@/src/components/landing/Nav';
import { Problem } from '@/src/components/landing/Problem';
import { Trust } from '@/src/components/landing/Trust';

/**
 * Public landing page.
 *
 * Every section except the navigation, the hero canvas and the demo is a server
 * component, so the copy, the FAQ answers and the product explanation ship as
 * static HTML. The three client components are the only JavaScript this route
 * needs, and each exists because the section is genuinely interactive.
 */
export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Demo />
        <Problem />
        <Trust />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
