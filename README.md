<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/wave-telecom/wave-tech-framework">
    <img src="https://i.ibb.co/bgFN2K5B/wave-logo-stamp-negative.png" alt="Logo" height="80">
  </a>

<h3 align="center">Wave Tech Shared Framework</h3>

  <p align="center">
    A framework made by Wavers to reuse code in a smarter way. 😎
    <br />
    <a href="https://www.wavebybemobi.com/"><strong>Get to know more about us »</strong></a>
    <br />
    <br />
    <a href="https://vagas.wavebybemobi.com/">Carrers</a>
    &middot;
    <a href="https://github.com/wave-telecom/wave-tech-framework/issues/new?template=%F0%9F%90%9B-bug-report.md">Report Bug</a>
    &middot;
    <a href="https://github.com/wave-telecom/wave-tech-framework/issues/new?template=%F0%9F%92%A1-feature-request.md">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#contributing">Contributing</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project
Tired of rewriting the same code over and over again? We are too.

This is a framework made by us, Wavers and developers like you, to increase our productivity and code quality.

### Built With

- [TypeScript](https://www.typescriptlang.org/)
- [Node.js](https://nodejs.org/)

<!-- GETTING STARTED -->
## Getting Started
This is a guide to help you get started with the Wave Tech Shared Framework.

### Installation
Below are the steps you need to follow to install the framework.

1. Install the package with a package manager of your choice (npm, pnpm, yarn, etc.)
```typescript
npm install @wave-tech/framework
```

2. Import the resources you need
```typescript
import { Logger } from '@wave-tech/framework/core';
```

3. Use the package
```typescript
Logger.initialize('my-app');
Logger.info('Hello, world!');
```

<!-- CONTRIBUTING -->
## Contributing
We are passionate about open source projects and we are always looking for new ways to improve our framework. With that said, we are open to contributions and *would love* to have your help.

If you have any suggestions, ideas or feedback, please feel free to open an issue or to create a fork and send us a pull request.

### Contributing Guidelines

1. Fork the repository
2. Create a new branch for your feature (`git checkout -b feature/amazing-feature`)
3. Test the library locally
    - Build the library with your changes (`pnpm run build`)
    - Copy the local path of the library directory (`pwd`)
    - Install the local library in the local consumer application (`npm i </path/to/wave-tech/framework>`)
    - Test the library in the consumer application.
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request.

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/github/contributors/wave-telecom/wave-tech-framework.svg?style=for-the-badge
[contributors-url]: https://github.com/wave-telecom/wave-tech-framework/graphs/contributors
[stars-shield]: https://img.shields.io/github/stars/wave-telecom/wave-tech-framework.svg?style=for-the-badge
[stars-url]: https://github.com/wave-telecom/wave-tech-framework/stargazers
[issues-shield]: https://img.shields.io/github/issues/wave-telecom/wave-tech-framework.svg?style=for-the-badge
[issues-url]: https://github.com/wave-telecom/wave-tech-framework/issues
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/company/wave-by-bemobi/
