---
name: jmeter
description: Use when the user wants to create, generate, or run a JMeter load test, stress test, or performance test. Triggers on mentions of JMeter, JMX, load testing, stress testing, "hit endpoint with N threads", or "call endpoint N times".
---

# JMeter Test Plan Generator

Generate JMX test plans from natural language descriptions and open them in JMeter GUI for the user to tweak, run, and visualize.

## JMeter Binary

Resolve it in this order, and stop at the first hit:

```
$JMETER_HOME/bin/jmeter        # if the env var is set
jmeter                         # if it is on the PATH
```

If neither resolves, ask the user where their JMeter install lives (or to
`brew install jmeter`) — do not guess a path.

## Workflow

1. Parse the user's natural language request into: endpoint(s), method, threads, loops/duration, headers, body
2. Generate a `.jmx` file at `/tmp/jmeter-<descriptive-name>.jmx`
3. Open in JMeter GUI: run the binary with `-t <file> &` in background
4. Tell the user the file is open and what was configured

## Defaults

When the user doesn't specify:
- **Host:** localhost
- **Port:** 8080
- **Protocol:** http (leave empty string in JMX)
- **Threads:** 100
- **Ramp-up:** 1 second
- **Loops:** 100 (per thread)
- **Method:** GET
- **Always include:** Summary Report + View Results Tree per thread group

## JMX Reference

Use `jmx-reference.md` in this skill directory for the complete XML building blocks (TestPlan, ThreadGroup, HTTP Sampler, Headers, Listeners, etc.) and nesting rules.

## Tips

- When user says "100K requests on 10 threads" → loops = 100000 / 10 = 10000 per thread
- For duration-based tests, use scheduler=true with infinite loops (`LoopController.loops` = -1)
- For POST with JSON body, add a HeaderManager with Content-Type: application/json
- Multiple endpoints = multiple thread groups (all enabled) unless user says sequential
- Use `${variable}` syntax with RandomVariableConfig for parameterized requests
