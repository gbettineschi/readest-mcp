# Synthetic fixtures

EPUBs and ordinary PDFs are generated in the test helpers from short original example text. No personal books or annotations are included.

`scanned-page.png` contains two original synthetic English sentences rendered for the opt-in local OCR check. It is embedded into a generated PDF during the test; no personal scan is included.

`password.pdf` was generated with PDFKit 0.20.2 using `generate-password.cjs`. It contains one synthetic sentence; its public test passwords are `fixture-reader` and `fixture-owner`. PDFKit is only needed to regenerate that binary, not to run this project or its tests. To regenerate, pass the path to PDFKit's Node module to the generator.
