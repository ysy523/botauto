const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: true});
  const page = await browser.newPage();

  const results = [];
  const maxPages = 10; // Limit to 10 pages
  let currentPage = 1;

  while (currentPage <= maxPages) {
    console.log(`Scraping page ${currentPage}...`);

    await page.goto('https://www.pickastock.info/search?q=epf', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.search-card', { timeout: 60000 });

    const pageResults = await page.evaluate(() => {
      const cards = document.querySelectorAll('.search-card');
      return Array.from(cards).map(card => {
        const dateText = card.querySelector('.gray')?.textContent.trim();
        const title = card.querySelector('.search-card-title a')?.textContent.trim();
        const name = card.querySelector('small.gray ~ div a')?.textContent.trim();
        const dateOfChange = card.querySelector('.gray.one-line ~ div')?.textContent.trim();

        const totalAfterChangeElement = Array.from(card.querySelectorAll('small.gray.one-line'))
          .find(el => el.textContent.trim() === 'Total after Chg.')?.nextElementSibling;
        const totalAfterChange = totalAfterChangeElement ? totalAfterChangeElement.textContent.trim().replace(/,/g, '') : 'Not Available';

        const acquiredElement = card.querySelector('small.gray.green + div');
        const acquiredValue = acquiredElement ? acquiredElement.textContent.trim().replace(/,/g, '') : '';

        const disposedElement = card.querySelector('small.gray.red + div');
        const disposedValue = disposedElement ? disposedElement.textContent.trim().replace(/,/g, '') : '';

        const others =  null;
        
        return {
          date: dateText,
          title,
          name,
          dateOfChange,
          others,
          totalAfterChange,
          disposedValue,
          acquiredValue,
          remarks: card.querySelector('.one-line.w-100.clickable')?.textContent.trim()
        };
      });
    });

    console.log(pageResults);

    const filteredResults = pageResults.filter(result => result.name === 'EMPLOYEES PROVIDENT FUND BOARD');
    if (filteredResults.length > 0) {
      results.push(...filteredResults);
      console.log(`Found ${filteredResults.length} results on page ${currentPage} with the name "EMPLOYEES PROVIDENT FUND BOARD".`);
    } else {
      console.log('No results found on this page with the name "EMPLOYEES PROVIDENT FUND BOARD".');
    }

    const hasNextPage = await page.evaluate(() => {
      const nextButton = document.querySelector('.pagination li:not(.disabled) a i.fa-angle-right');
      return nextButton !== null;
    });

    if (hasNextPage) {
      console.log('Moving to the next page...');
      await page.evaluate(() => {
        const nextButton = document.querySelector('.pagination li:not(.disabled) a i.fa-angle-right');
        if (nextButton) {
          nextButton.closest('a').click();
        }
      });
      await page.waitForFunction(() => document.querySelectorAll('.search-card').length > 0, { timeout: 60000 });
      currentPage++;
    } else {
      console.log('No more pages or no relevant data found.');
      break;
    }
  }

  if (results.length === 0) {
    console.log('No data found.');
    await browser.close();
    return;
  }

  // Calculate percentage changes based on Total after Chg:
  const processedResults = results.map((result, index) => {
    const totalAfterChange = parseFloat(result.totalAfterChange.replace(/,/g, ''));
    const acquired = parseFloat(result.acquiredValue.replace(/,/g, '')) || 0;
    const disposed = parseFloat(result.disposedValue.replace(/,/g, '')) || 0;
    const previousTotal = index > 0 ? parseFloat(results[index - 1].totalAfterChange.replace(/,/g, '')) : null;

    const calculatePercentageChange = (current, previous) => {
      if (isNaN(previous) || isNaN(current) || previous === 0) return 'N/A';
      return ((current - previous) / previous * 100).toFixed(2) + '%';
    };

    const percentageChange = previousTotal !== null ? calculatePercentageChange(totalAfterChange, previousTotal) : 'N/A';
    
    // Calculate percentage increase or decrease for Acquired and Disposed
    const acquiredPercentageChange = acquired ? ((acquired / totalAfterChange) * 100).toFixed(2) + '%' : 'N/A';
    const disposedPercentageChange = disposed ? ((disposed / totalAfterChange) * 100).toFixed(2) + '%' : 'N/A';

    return {
      ...result,
      totalAfterChange: totalAfterChange ? totalAfterChange.toLocaleString() : 'N/A',
      disposedValue: disposed ? disposed.toLocaleString() : '0',
      acquiredValue: acquired ? acquired.toLocaleString() : '0',
      percentageChange,
      acquiredPercentageChange,
      disposedPercentageChange
    };
  });

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Extracted Data PDF</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
      .card h2 { margin: 0 0 10px; }
      .card div { margin-bottom: 10px; }
      .card .gray { color: #666; }
      .card .bold { font-weight: bold; }
      .card .row { display: flex; justify-content: space-between; }
      .card .col { flex: 1; }
      .increase { color: green; }
      .decrease { color: red; }
    </style>
  </head>
  <body>
    ${processedResults.map(result => `
      <div class="card">
        <div class="gray">${result.date}</div>
        <h2>${result.title}</h2>
        <div><span class="bold">Name:</span> ${result.name}</div>
        <div class="row">
          <div class="col"><span class="bold">Date of Chg:</span> ${result.dateOfChange}</div>
          <div class="col"><span class="bold">Total after Chg:</span> ${result.totalAfterChange || 'N/A'}</div>
          ${result.disposedValue !== '0' ? `<div class="col"><span class="bold">Disposed:</span> ${result.disposedValue}</div>` : ''}
          ${result.acquiredValue !== '0' ? `<div class="col"><span class="bold">Acquired:</span> ${result.acquiredValue}</div>` : ''}
        </div>
        <div class="row">
          <div class="col"><span class="decrease">D(%):</span> ${result.disposedPercentageChange}</div>
          <div class="col"><span class="increase">A(%):</span> ${result.acquiredPercentageChange}</div>
          <div class="col"><span class="bold">Remarks:</span> ${result.remarks || 'N/A'}</div>
        </div>
      </div>
    `).join('')}
  </body>
  </html>
  `;

  fs.writeFileSync('data.html', htmlContent, 'utf8');

  await page.setContent(htmlContent);
  await page.pdf({
    path: 'results.pdf',
    format: 'A4',
    printBackground: true
  });

  console.log('PDF generated: results.pdf');

  await browser.close();
})();
