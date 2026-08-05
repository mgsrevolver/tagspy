#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadCapture, CaptureError } from '../src/capture.js';
import { decodeCapture } from '../src/decode.js';
import { runRules } from '../src/rules/index.js';
import { renderReport } from '../src/report.js';

const [command, path] = process.argv.slice(2);

if (command !== 'audit' || !path) {
  process.stderr.write('usage: tagspy audit <capture.json>\n');
  process.exit(2);
}

let capture;
try {
  capture = loadCapture(JSON.parse(readFileSync(path, 'utf8')));
} catch (error) {
  const label = error instanceof CaptureError ? 'invalid capture' : 'could not read capture';
  process.stderr.write(`tagspy: ${label}: ${error.message}\n`);
  process.exit(2);
}

const { events, errors } = decodeCapture(capture);
const findings = runRules(events, { errors });
process.stdout.write(renderReport(findings, { events }));

// Advisory findings never affect the exit code. process.exitCode (rather
// than process.exit) lets Node flush pending stdout writes: exit() kills
// them, silently truncating any report larger than one pipe buffer.
process.exitCode = 0;
