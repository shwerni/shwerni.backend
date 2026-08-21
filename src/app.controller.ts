// packages
import { Controller, Get, Header } from '@nestjs/common';

// utils
import { homeHtml } from './public/home.template';

@Controller()
export class AppController {
  // serves the plain status homepage at the base url, embedded directly
  // so no static file copy step is needed at build or deploy time
  @Get()
  @Header('Content-Type', 'text/html')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  getHome(): string {
    return homeHtml;
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain')
  getRobots(): string {
    return 'User-agent: *\nDisallow: /';
  }
}
