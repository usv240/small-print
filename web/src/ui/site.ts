// Shared UI for every page: theme toggle, mobile menu, table of contents, and deep links into
// collapsed sections. Presentation only; all page content is static HTML.

import { initAnchors } from './anchors';
import { initNav } from './nav';
import { initScrollRegions } from './scroll-regions';
import { initTheme } from './theme';
import { initToc } from './toc';

initTheme();
initNav();
initToc();
initAnchors();
initScrollRegions();
