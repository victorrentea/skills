# JMX Building Blocks Reference

## Skeleton

Every JMX file starts with this wrapper:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.4.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="TEST_PLAN_NAME" enabled="true">
      <stringProp name="TestPlan.comments"></stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.tearDown_on_shutdown">true</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
      <stringProp name="TestPlan.user_define_classpath"></stringProp>
    </TestPlan>
    <hashTree>
      <!-- Thread groups go here -->
    </hashTree>
  </hashTree>
</jmeterTestPlan>
```

## Thread Group

```xml
<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="GROUP_NAME" enabled="true">
  <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
  <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
    <boolProp name="LoopController.continue_forever">false</boolProp>
    <stringProp name="LoopController.loops">LOOP_COUNT</stringProp>
  </elementProp>
  <stringProp name="ThreadGroup.num_threads">NUM_THREADS</stringProp>
  <stringProp name="ThreadGroup.ramp_time">RAMP_SECONDS</stringProp>
  <boolProp name="ThreadGroup.scheduler">false</boolProp>
  <stringProp name="ThreadGroup.duration"></stringProp>
  <stringProp name="ThreadGroup.delay"></stringProp>
  <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
</ThreadGroup>
```

For duration-based (infinite loops + scheduler):
```xml
<intProp name="LoopController.loops">-1</intProp>
<!-- and -->
<boolProp name="ThreadGroup.scheduler">true</boolProp>
<stringProp name="ThreadGroup.duration">DURATION_SECONDS</stringProp>
```

## HTTP Sampler (GET)

```xml
<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="SAMPLER_NAME" enabled="true">
  <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
    <collectionProp name="Arguments.arguments"/>
  </elementProp>
  <stringProp name="HTTPSampler.domain">HOST</stringProp>
  <stringProp name="HTTPSampler.port">PORT</stringProp>
  <stringProp name="HTTPSampler.protocol"></stringProp>
  <stringProp name="HTTPSampler.contentEncoding"></stringProp>
  <stringProp name="HTTPSampler.path">PATH</stringProp>
  <stringProp name="HTTPSampler.method">GET</stringProp>
  <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
  <boolProp name="HTTPSampler.auto_redirects">false</boolProp>
  <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
  <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>
  <stringProp name="HTTPSampler.embedded_url_re"></stringProp>
  <stringProp name="HTTPSampler.connect_timeout"></stringProp>
  <stringProp name="HTTPSampler.response_timeout"></stringProp>
</HTTPSamplerProxy>
<hashTree/>
```

## HTTP Sampler (POST with JSON body)

```xml
<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="SAMPLER_NAME" enabled="true">
  <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
  <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
    <collectionProp name="Arguments.arguments">
      <elementProp name="" elementType="HTTPArgument">
        <boolProp name="HTTPArgument.always_encode">false</boolProp>
        <stringProp name="Argument.value">JSON_BODY_HERE</stringProp>
        <stringProp name="Argument.metadata">=</stringProp>
      </elementProp>
    </collectionProp>
  </elementProp>
  <stringProp name="HTTPSampler.domain">HOST</stringProp>
  <stringProp name="HTTPSampler.port">PORT</stringProp>
  <stringProp name="HTTPSampler.protocol"></stringProp>
  <stringProp name="HTTPSampler.contentEncoding">UTF-8</stringProp>
  <stringProp name="HTTPSampler.path">PATH</stringProp>
  <stringProp name="HTTPSampler.method">POST</stringProp>
  <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
  <boolProp name="HTTPSampler.auto_redirects">false</boolProp>
  <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
  <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>
  <stringProp name="HTTPSampler.embedded_url_re"></stringProp>
  <stringProp name="HTTPSampler.connect_timeout"></stringProp>
  <stringProp name="HTTPSampler.response_timeout"></stringProp>
</HTTPSamplerProxy>
<hashTree/>
```

## Header Manager

Place inside thread group hashTree, before samplers.

```xml
<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true">
  <collectionProp name="HeaderManager.headers">
    <elementProp name="" elementType="Header">
      <stringProp name="Header.name">HEADER_NAME</stringProp>
      <stringProp name="Header.value">HEADER_VALUE</stringProp>
    </elementProp>
  </collectionProp>
</HeaderManager>
<hashTree/>
```

## Summary Report

```xml
<ResultCollector guiclass="SummaryReport" testclass="ResultCollector" testname="Summary Report" enabled="true">
  <boolProp name="ResultCollector.error_logging">false</boolProp>
  <objProp>
    <name>saveConfig</name>
    <value class="SampleSaveConfiguration">
      <time>true</time>
      <latency>true</latency>
      <timestamp>true</timestamp>
      <success>true</success>
      <label>true</label>
      <code>true</code>
      <message>true</message>
      <threadName>true</threadName>
      <dataType>true</dataType>
      <encoding>false</encoding>
      <assertions>true</assertions>
      <subresults>true</subresults>
      <responseData>false</responseData>
      <samplerData>false</samplerData>
      <xml>false</xml>
      <fieldNames>true</fieldNames>
      <responseHeaders>false</responseHeaders>
      <requestHeaders>false</requestHeaders>
      <responseDataOnError>false</responseDataOnError>
      <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
      <assertionsResultsToSave>0</assertionsResultsToSave>
      <bytes>true</bytes>
      <sentBytes>true</sentBytes>
      <url>true</url>
      <threadCounts>true</threadCounts>
      <idleTime>true</idleTime>
      <connectTime>true</connectTime>
    </value>
  </objProp>
  <stringProp name="filename"></stringProp>
</ResultCollector>
<hashTree/>
```

## View Results Tree

Same as Summary Report but with `guiclass="ViewResultsFullVisualizer"` and `testname="View Results Tree"`.

## Random Variable

```xml
<RandomVariableConfig guiclass="TestBeanGUI" testclass="RandomVariableConfig" testname="Random Variable" enabled="true">
  <stringProp name="maximumValue">MAX</stringProp>
  <stringProp name="minimumValue">MIN</stringProp>
  <stringProp name="outputFormat">0000000</stringProp>
  <boolProp name="perThread">true</boolProp>
  <stringProp name="randomSeed"></stringProp>
  <stringProp name="variableName">VAR_NAME</stringProp>
</RandomVariableConfig>
<hashTree/>
```

Reference with `${VAR_NAME}` in samplers/headers.

## Nesting Rules

```
TestPlan
  hashTree
    ThreadGroup1
    hashTree              ← children of ThreadGroup1
      HeaderManager       ← optional, before samplers
      hashTree/           ← empty
      HTTPSampler1
      hashTree/           ← empty
      ResultCollector     ← Summary Report
      hashTree/           ← empty
      ResultCollector     ← View Results Tree
      hashTree/           ← empty
    ThreadGroup2
    hashTree              ← children of ThreadGroup2
      ...
```

Every element MUST be followed by a `<hashTree>` (with children) or `<hashTree/>` (empty).
