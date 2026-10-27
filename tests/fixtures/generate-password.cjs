// Optional fixture regeneration: pass an installed PDFKit module path as argv[2].
// PDFKit is not a runtime or test dependency; the generated synthetic PDF is committed.
const { PDFDocument } = require(process.argv[2] || 'pdfkit');
const fs = require('node:fs');
const path = require('node:path');
const doc = new PDFDocument({userPassword:'fixture-reader',ownerPassword:'fixture-owner',pdfVersion:'1.7'});
doc.pipe(fs.createWriteStream(path.join(__dirname,'password.pdf')));
doc.text('Synthetic password-protected parser fixture.');
doc.end();
