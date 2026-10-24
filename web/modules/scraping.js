async function scrape() {
  const url = $('surl').value.trim(); if (!url) return msg('Paste a product page URL');
  try {
    toast('Importing…');
    const d = await api('/scrape', { method: 'POST', body: { urls: [url], category: $('scat').value } });
    toast(d.count ? `Imported ${d.count} product${d.count === 1 ? '' : 's'} for review` : 'No product with an image was found on that page');
    $('surl').value = ''; await Promise.all([loadAdminProducts(), loadAnalytics()]);
  } catch (e) { msg(e.message); }
}
