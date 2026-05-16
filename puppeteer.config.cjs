// O script usa `channel: 'chrome'` (o Chrome instalado na máquina), então não
// precisamos do Chromium que o puppeteer baixaria — pula o download no install.
module.exports = { skipDownload: true };
