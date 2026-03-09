import { flow, Message, Custom } from '@robomotion/sdk';

flow.create('ai-workflow-engine', 'AI Workflow Engine', (f) => {
  f.addDependency('Core', '1.0.0');

  f.node('httpIn', 'Core.Net.HttpIn', 'HTTP In', {
    optMethod: 'POST',
    optEndpointV2: Custom('/'),
    optIPv2: Custom('127.0.0.1'),
    optPortv2: Custom('9090')
  })

  .then('normalize', 'Core.Programming.Function', 'Normalize Inbound Request', {
    func: `const body = (msg.body && typeof msg.body === "object") ? msg.body : {};
msg.body = body;
msg.phase = (msg.phase && typeof msg.phase === "object") ? msg.phase : {};
msg.phase.poll_attempts = Number(msg.phase.poll_attempts || 0);
msg.phase.max_poll_attempts = Number(body.max_poll_attempts || msg.phase.max_poll_attempts || 60);
return msg;`
  })

  .edge('normalize', 'buildStart', 0, 0)

  .node('buildStart', 'Core.Programming.Function', 'Build Phase Start Request', {
    func: `const body = (msg.body && typeof msg.body === "object") ? msg.body : {};
const requestId = String(msg.id || "").trim() || String(Date.now());

msg.phase = msg.phase || {};
msg.phase.name = "start";

msg.body = {
  meta: {
    source: "robomotion",
    request_id: requestId
  },
  prefill: {
    mode: String(body.mode || "").trim() || "dev",
    backend: String(body.backend || "").trim() || "openai",
    project_focus: String(body.project_focus || "").trim(),
    prompt_profile: String(body.prompt_profile || "").trim()
  }
};

return msg;`
  })

  .edge('buildStart', 'phaseStart', 0, 0)

  .node('phaseStart', 'Core.Net.HttpRequest', 'Phase Start', {
    optUrl: Custom('http://127.0.0.1:8787/api/phase/start'),
    optMethod: 'post',
    inBody: Message('body'),
    outBody: Message('resp')
  })

  .edge('phaseStart', 'saveStartResponse', 0, 0)

  .node('saveStartResponse', 'Core.Programming.Function', 'Save Start Response', {
    func: `const res = (msg.resp && typeof msg.resp === "object") ? msg.resp : {};

msg.phase = msg.phase || {};
msg.phase.run_id = String(res.run_id || msg.phase.run_id || "").trim();
msg.phase.session_id = String(res.session_id || msg.phase.session_id || "").trim();
msg.phase.status = String(res.status || msg.phase.status || "").trim();
msg.phase.current_phase = String(res.current_phase || msg.phase.current_phase || "").trim();
msg.phase.next_phase = String(res.next_phase || msg.phase.next_phase || "").trim();
msg.phase.popup_session_id = String(res.popup_session_id || msg.phase.popup_session_id || "").trim();

if (!msg.phase.status) {
  msg.phase.status = "error";
  msg.phase.error = "Invalid start response";
}

return msg;`
  })

  .edge('saveStartResponse', 'startSwitch', 0, 0)

  .node('startSwitch', 'Core.Programming.Switch', 'Start Phase Switch', {
    optConditions: [
      Custom('msg.phase && msg.phase.status === "waiting_for_popup"'),
      Custom('msg.phase && msg.phase.status === "ready"'),
      Custom('msg.phase && msg.phase.status === "canceled"'),
      Custom('msg.phase && msg.phase.status === "error"'),
      Custom('true')
    ]
  })

  .edge('startSwitch', 'pollWait', 0, 0)
  .edge('startSwitch', 'buildLoop', 1, 0)
  .edge('startSwitch', 'finalResponse', 2, 0)
  .edge('startSwitch', 'finalResponse', 3, 0)
  .edge('startSwitch', 'markUnexpectedStart', 4, 0)

  .node('markUnexpectedStart', 'Core.Programming.Function', 'Unexpected Start Status', {
    func: `msg.phase = msg.phase || {};
msg.phase.status = "error";
msg.phase.error = "Unexpected start status";
return msg;`
  })

  .edge('markUnexpectedStart', 'finalResponse', 0, 0)

  .node('pollWait', 'Core.Programming.Sleep', 'Start Poll Wait', {
    optDuration: Custom('2')
  })

  .edge('pollWait', 'buildPoll', 0, 0)

  .node('buildPoll', 'Core.Programming.Function', 'Build Phase Start Poll Request', {
    func: `msg.phase = msg.phase || {};
msg.phase.poll_attempts = Number(msg.phase.poll_attempts || 0) + 1;

const runId = String(msg.phase.run_id || "").trim();
const maxPoll = Number(msg.phase.max_poll_attempts || 60);

if (!runId) {
  msg.phase.status = "error";
  msg.phase.error = "Missing run_id for polling";
  return msg;
}

if (msg.phase.poll_attempts > maxPoll) {
  msg.phase.status = "error";
  msg.phase.error = "Polling timeout exceeded";
  return msg;
}

msg.body = { run_id: runId };
return msg;`
  })

  .edge('buildPoll', 'pollGate', 0, 0)

  .node('pollGate', 'Core.Programming.Switch', 'Poll Gate', {
    optConditions: [
      Custom('msg.phase && msg.phase.status === "error"'),
      Custom('true')
    ]
  })

  .edge('pollGate', 'finalResponse', 0, 0)
  .edge('pollGate', 'phaseStart', 1, 0)

  .node('buildLoop', 'Core.Programming.Function', 'Build Phase Loop Request', {
    func: `const phase = (msg.phase && typeof msg.phase === "object") ? msg.phase : {};
msg.phase = phase;
msg.phase.name = "loop";

const runId = String(phase.run_id || "").trim();
const sessionId = String(phase.session_id || "").trim();

if (!runId || !sessionId) {
  msg.phase.status = "error";
  msg.phase.error = "Missing run_id/session_id for loop";
  return msg;
}

msg.body = {
  run_id: runId,
  session_id: sessionId
};

return msg;`
  })

  .edge('buildLoop', 'phaseLoop', 0, 0)

  .node('phaseLoop', 'Core.Net.HttpRequest', 'Phase Loop', {
    optUrl: Custom('http://127.0.0.1:8787/api/phase/loop'),
    optMethod: 'post',
    inBody: Message('body'),
    outBody: Message('resp')
  })

  .edge('phaseLoop', 'saveLoopResponse', 0, 0)

  .node('saveLoopResponse', 'Core.Programming.Function', 'Save Loop Response', {
    func: `const res = (msg.resp && typeof msg.resp === "object") ? msg.resp : {};

msg.phase = msg.phase || {};
msg.phase.run_id = String(res.run_id || msg.phase.run_id || "").trim();
msg.phase.session_id = String(res.session_id || msg.phase.session_id || "").trim();
msg.phase.status = String(res.status || msg.phase.status || "").trim();
msg.phase.current_phase = String(res.current_phase || msg.phase.current_phase || "").trim();
msg.phase.next_phase = String(res.next_phase || msg.phase.next_phase || "").trim();
msg.phase.popup_session_id = String(res.popup_session_id || msg.phase.popup_session_id || "").trim();

if (!msg.phase.status) {
  msg.phase.status = "error";
  msg.phase.error = "Invalid loop response";
}

return msg;`
  })

  .edge('saveLoopResponse', 'loopSwitch', 0, 0)

  .node('loopSwitch', 'Core.Programming.Switch', 'Loop Phase Switch', {
    optConditions: [
      Custom('msg.phase && msg.phase.status === "error"'),
      Custom('msg.phase && msg.phase.next_phase === "loop"'),
      Custom('msg.phase && msg.phase.next_phase === "review"'),
      Custom('msg.phase && msg.phase.next_phase === "finalize"'),
      Custom('true')
    ]
  })

  .edge('loopSwitch', 'finalResponse', 0, 0)
  .edge('loopSwitch', 'buildLoop', 1, 0)
  .edge('loopSwitch', 'finalResponse', 2, 0)
  .edge('loopSwitch', 'finalResponse', 3, 0)
  .edge('loopSwitch', 'markUnexpectedLoop', 4, 0)

  .node('markUnexpectedLoop', 'Core.Programming.Function', 'Unexpected Loop State', {
    func: `msg.phase = msg.phase || {};
msg.phase.status = "error";
msg.phase.error = "Unexpected next_phase in loop";
return msg;`
  })

  .edge('markUnexpectedLoop', 'finalResponse', 0, 0)

  .node('finalResponse', 'Core.Programming.Function', 'Final HTTP Response', {
    func: `msg.phase = msg.phase || {};
const status = String(msg.phase.status || "").trim();

let httpStatus = 200;
if (status === "canceled") httpStatus = 409;
if (status === "error") httpStatus = 500;

msg.http_status = httpStatus;
msg.body = {
  ok: !(status === "error" || status === "canceled"),
  run_id: String(msg.phase.run_id || ""),
  session_id: String(msg.phase.session_id || ""),
  current_phase: String(msg.phase.current_phase || ""),
  next_phase: String(msg.phase.next_phase || ""),
  status,
  error: String(msg.phase.error || "")
};

return msg;`
  })

  .edge('finalResponse', 'httpOut', 0, 0)

  .node('httpOut', 'Core.Net.HttpOut', 'HTTP Out', {
    inBody: Message('body'),
    inStatus: Message('http_status')
  });

}).start();
