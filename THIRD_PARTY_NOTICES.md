# Third-party notices

Original Readest MCP code is MIT licensed. No Readest application code is incorporated; its published formats and sync implementation are compatibility references. Readest is an independent project and does not endorse this server.

Dependencies retain their own licenses and notices in the installed packages:

| Direct runtime dependency | License |
|---|---|
| @modelcontextprotocol/server 2.4.0 | Apache-2.0 |
| @supabase/supabase-js 2.118.0 | MIT |
| fast-xml-parser 5.11.2 | MIT |
| linkedom 0.18.14 | ISC |
| pdfjs-dist 6.4.299 | Apache-2.0 |
| yauzl 3.4.0 | MIT |
| zod 4.6.7 | MIT |
| @huggingface/transformers 4.3.1 (optional) | Apache-2.0 |

`package-lock.json` pins the dependency tree. Native/optional transitive packages, including ONNX Runtime and tokenizer components, retain their included notices. Development tools and generated PDF/EPUB fixtures are not application dependencies or personal books.

## Optional model

[Xenova/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2), commit `2c4055b12046f11709e9df2c122e59ffbdc2f900`, is the quantized ONNX conversion of [sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2). Its model card declares Apache-2.0; see the [upstream license](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/blob/main/LICENSE). Files are explicitly downloaded from Hugging Face, verified against `src/index/model.json`, and not included in this repository or package.

## Optional OCR

[Tesseract](https://github.com/tesseract-ocr/tesseract) and [tessdata language models](https://github.com/tesseract-ocr/tessdata_fast) are separately installed, Apache-2.0 licensed tools/data. They are not bundled or automatically downloaded by this server. PDF rendering uses PDF.js and its optional MIT-licensed [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) dependency, whose native packages retain their own notices.
