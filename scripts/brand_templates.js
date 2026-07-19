#!/usr/bin/env node
'use strict';

const TEMPLATES = [
  ['editorial-red','杂志红','pushIn','pullBack'], ['midnight-gold','午夜金','panRight','pullBack'],
  ['paper-note','纸张笔记','panDown','pushIn'], ['neo-brutal','新粗野','pushIn','panLeft'],
  ['cinema-frame','电影画框','pullBack','pushIn'], ['ink-wash','水墨留白','panDown','pullBack'],
  ['glass-blue','玻璃蓝','pushIn','panRight'], ['retro-tv','复古电视','pullBack','panDown'],
  ['type-grid','字体网格','panRight','panLeft'], ['warm-book','温暖书页','pushIn','pullBack'],
  ['signal-green','信号绿','panUp','pushIn'], ['monochrome','黑白极简','pullBack','none'],
  ['sunset-card','落日卡片','panLeft','pullBack'], ['chalk-class','黑板课堂','pushIn','panDown'],
  ['ticket-stub','电影票根','panRight','pullBack'], ['gradient-orbit','渐变轨道','pushIn','panLeft'],
  ['news-flash','新闻快讯','panLeft','pushIn'], ['soft-pastel','柔和粉彩','panDown','pullBack'],
  ['tech-line','科技线框','pushIn','panUp'], ['signature','签名字标','pullBack','pushIn']
].map(([id,name,introMotion,outroMotion], index) => ({ id, name, introMotion, outroMotion, index: index + 1 }));

function chooseTemplate(context = '') {
  const text = String(context).toLowerCase();
  if (/电影|movie|cinema/.test(text)) return 'cinema-frame';
  if (/英语|english|学习|句子/.test(text)) return 'editorial-red';
  if (/科技|ai|tech/.test(text)) return 'tech-line';
  if (/温暖|故事|book/.test(text)) return 'warm-book';
  return 'type-grid';
}

function buildBrandCards(options = {}) {
  const id = options.templateId || chooseTemplate(options.context);
  const template = TEMPLATES.find((item) => item.id === id);
  if (!template) throw new Error(`Unknown brand template: ${id}`);
  return {
    template,
    intro: { duration: 1.8, layout: `${id}-intro`, motion: template.introMotion, brand: '向阳乔木' },
    outro: { duration: 2.6, layout: `${id}-outro`, motion: 'none', transition: 'snap-flash-pop', publicText: ['向阳乔木', '@vista8', options.cta || '关注向阳乔木，学会真正能用的英语'], brand: '向阳乔木', handle: '@vista8', cta: options.cta || '关注向阳乔木，学会真正能用的英语' }
  };
}

module.exports = { TEMPLATES, chooseTemplate, buildBrandCards };
if (require.main === module) process.stdout.write(JSON.stringify(buildBrandCards({ context: process.argv.slice(2).join(' ') }), null, 2) + '\n');
