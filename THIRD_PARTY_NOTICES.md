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

[Xenova/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small), commit `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, is the quantized ONNX conversion of [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small). The model card declares MIT. Files are explicitly downloaded from Hugging Face, verified against `src/index/model.json`, and not included in this repository or package. Upstream work: [Microsoft E5](https://github.com/microsoft/unilm/tree/master/e5), [license](https://github.com/microsoft/unilm/blob/master/LICENSE).

The MIT License (MIT)

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
