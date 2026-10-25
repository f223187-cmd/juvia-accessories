if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1) || 'shop');
loadProducts();
window.Motion?.magnetic($('heroCta'));
window.Motion?.onScroll($('features'));
boot();
window.addEventListener('load', () => window.scrollTo(0, 0));
