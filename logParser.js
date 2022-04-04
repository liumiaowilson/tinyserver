const typePattern = /^[A-Z_]*$/, truncateColor = new Map([
    ["error", "rgba(255, 128, 128, 0.2)"],
    ["skip", "rgba(128, 255, 128, 0.2)"],
    ["unexpected", "rgba(128, 128, 255, 0.2)"],
]);
class TimeStampedNode {
    constructor() {
        this.timestamp = 0;
        this.exitStamp = null;
        this.duration = null;
        this.selfTime = null;
        this.children = null;
    }
}

class LogLine extends TimeStampedNode {
    constructor(parts) {
        super();
        this.type = "";
        this.logLine = "";
        this.acceptsText = false;
        this.text = "";
        this.displayType = "";
        this.children = null;
        this.isExit = false;
        this.discontinuity = false;
        this.exitTypes = null;
        this.lineNumber = null;
        this.rowCount = null;
        this.classes = null;
        this.group = null;
        this.truncated = null;
        this.hideable = null;
        this.containsDml = false;
        this.containsSoql = false;
        this.value = null;
        this.suffix = null;
        this.prefix = null;
        this.namespace = null;
        this.cpuType = null;
        this.timelineKey = null;
        if (parts) {
            this.type = parts[1];
            this.timestamp = parseTimestamp(parts[0]);
        }
    }
    onEnd(end) { }
    after(next) { }
    addBlock(lines) {
        if (lines.length > 0) {
            if (this.children === null) {
                this.children = [];
            }
            this.children.push(new BlockLines(lines));
        }
    }
    addChild(line) {
        if (this.children === null) {
            this.children = [];
        }
        this.children.push(line);
    }
    setChildren(lines) {
        this.children = lines;
    }
}

class BlockLines extends LogLine {
    constructor(children) {
        super();
        this.displayType = "block";
        this.children = children;
    }
}

let logLines = [], truncated, reasons = new Set(), cpuUsed = 0;
function truncateLog(timestamp, reason, color) {
    if (!reasons.has(reason)) {
        reasons.add(reason);
        truncated.push([reason, timestamp, truncateColor.get(color)]);
    }
}

function parseObjectNamespace(text) {
    const sep = text.indexOf("__");
    if (sep < 0) {
        return "unmanaged";
    }
    return text.substring(0, sep);
}

function parseVfNamespace(text) {
    const sep = text.indexOf("__");
    if (sep < 0) {
        return "unmanaged";
    }
    const firstSlash = text.indexOf("/");
    if (firstSlash < 0) {
        return "unmanaged";
    }
    const secondSlash = text.indexOf("/", firstSlash + 1);
    if (secondSlash < 0) {
        return "unmanaged";
    }
    return text.substring(secondSlash + 1, sep);
}

function parseTimestamp(text) {
    const timestamp = text.slice(text.indexOf("(") + 1, -1);
    if (timestamp) {
        return Number(timestamp);
    }
    throw new Error(`Unable to parse timestamp: '${text}'`);
}

function parseLineNumber(text) {
    const lineNumberStr = text.slice(1, -1);
    if (lineNumberStr) {
        const lineNumber = Number(lineNumberStr);
        return isNaN(lineNumber) ? lineNumberStr : lineNumber;
    }
    throw new Error(`Unable to parse line number: '${text}'`);
}

function parseRows(text) {
    const rowCount = text.slice(text.indexOf("Rows:") + 5);
    if (rowCount) {
        return Number(rowCount);
    }
    throw new Error(`Unable to parse row count: '${text}'`);
}

/* Log line entry Parsers */
class BulkHeapAllocateLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class CalloutRequestLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[3]} : ${parts[2]}`;
    }
}
class CalloutResponseLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[3]} : ${parts[2]}`;
    }
}
class NamedCredentialRequestLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
    }
}
class NamedCredentialResponseLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}`;
    }
}
class NamedCredentialResponseDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[3]} : ${parts[4]} ${parts[5]} : ${parts[6]} ${parts[7]}`;
    }
}
class ConstructorEntryLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["CONSTRUCTOR_EXIT"];
        this.displayType = "method";
        this.cpuType = "method";
        this.suffix = " (constructor)";
        this.timelineKey = "method";
        this.classes = "node";
        this.lineNumber = parseLineNumber(parts[2]);
        const args = parts[4];
        this.text = parts[5] + args.substring(args.lastIndexOf("("));
    }
}
class ConstructorExitLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class EmailQueueLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class MethodEntryLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["METHOD_EXIT"];
        this.displayType = "method";
        this.cpuType = "method";
        this.timelineKey = "method";
        this.classes = "node";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[4] || this.type;
        if (this.text === "System.Type.forName(String, String)") {
            this.cpuType = "loading"; // assume we are not charged for class loading (or at least not lengthy remote-loading / compiling)
            // no namespace or it will get charged...
        }
    }
}

class MethodExitLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class SystemConstructorEntryLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["SYSTEM_CONSTRUCTOR_EXIT"];
        this.displayType = "method";
        this.cpuType = "method";
        this.namespace = "system";
        this.suffix = "(system constructor)";
        this.timelineKey = "systemMethod";
        this.classes = "node system";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[3];
    }
}
class SystemConstructorExitLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class SystemMethodEntryLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["SYSTEM_METHOD_EXIT"];
        this.displayType = "method";
        this.cpuType = "method";
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.classes = "node system";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[3];
    }
}
class SystemMethodExitLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class CodeUnitStartedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["CODE_UNIT_FINISHED"];
        this.displayType = "method";
        this.suffix = " (entrypoint)";
        this.timelineKey = "codeUnit";
        this.classes = "node";
        const subParts = parts[3].split(":"), name = parts[4] || parts[3];
        switch (subParts[0]) {
            case "EventService":
                this.cpuType = "method";
                this.namespace = parseObjectNamespace(subParts[1]);
                this.group = "EventService " + this.namespace;
                this.text = parts[3];
                break;
            case "Validation":
                this.cpuType = "custom";
                this.declarative = true;
                this.group = "Validation";
                this.text = name || subParts[0] + ":" + subParts[1];
                break;
            case "Workflow":
                this.cpuType = "custom";
                this.declarative = true;
                this.group = "Workflow";
                this.text = name || subParts[0];
                break;
            default:
                this.cpuType = "method";
                if (name === null || name === void 0 ? void 0 : name.startsWith("VF:")) {
                    this.namespace = parseVfNamespace(name);
                }
                this.text = name || parts[3]; // ???
                break;
        }
    }
}

class CodeUnitFinishedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.text = parts[2];
    }
}

class VFApexCallStartLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["VF_APEX_CALL_END"];
        this.displayType = "method";
        this.cpuType = "method";
        this.suffix = " (VF APEX)";
        this.classes = "node";
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class VFApexCallEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.text = parts[2];
    }
}
class VFDeserializeViewstateBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["VF_DESERIALIZE_VIEWSTATE_END"];
        this.displayType = "method";
        this.cpuType = "method";
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.text = this.type;
    }
}
class VFDeserializeViewstateEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class VFFormulaStartLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["VF_EVALUATE_FORMULA_END"];
        this.cpuType = "custom";
        this.suffix = " (VF FORMULA)";
        this.classes = "node formula";
        this.text = parts[3];
        this.group = this.type;
    }
}
class VFFormulaEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.text = parts[2];
    }
}
class VFSeralizeViewStateStartLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["VF_SERIALIZE_VIEWSTATE_END"];
        this.displayType = "method";
        this.cpuType = "method";
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.text = this.type;
    }
}
class VFSeralizeViewStateEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class VFPageMessageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class DMLBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["DML_END"];
        this.displayType = "method";
        this.cpuType = "free";
        this.timelineKey = "dml";
        this.group = "DML";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = "DML " + parts[3] + " " + parts[4];
        this.rowCount = parseRows(parts[5]);
    }
}
class DMLEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class IdeasQueryExecuteLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class SOQLExecuteBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["SOQL_EXECUTE_END"];
        this.displayType = "method";
        this.cpuType = "free";
        this.timelineKey = "soql";
        this.group = "SOQL";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = "SOQL: " + parts[3] + " - " + parts[4];
    }
    onEnd(end) {
        this.rowCount = end.rowCount;
    }
}
class SOQLExecuteEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
        this.rowCount = parseRows(parts[3]);
    }
}
class SOQLExecuteExplainLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = `${parts[3]}, line:${this.lineNumber}`;
    }
}
class SOSLExecuteBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["SOSL_EXECUTE_END"];
        this.displayType = "method";
        this.cpuType = "free";
        this.timelineKey = "soql";
        this.group = "SOQL";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = `SOSL: ${parts[3]}`;
    }
    onEnd(end) {
        this.rowCount = end.rowCount;
    }
}
class SOSLExecuteEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
        this.rowCount = parseRows(parts[3]);
    }
}
class HeapAllocateLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class HeapDeallocateLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class StatementExecuteLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
    }
}
class VariableScopeBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.prefix = "ASSIGN ";
        this.classes = "node detail";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[3];
        this.group = this.type;
        this.value = parts[4];
    }
    onEnd(end) {
        this.value = end.value;
    }
}
class VariableScopeEndLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class VariableAssignmentLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[3];
        this.group = this.type;
        this.value = parts[4];
    }
}
class UserInfoLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = this.type + ":" + parts[3] + " " + parts[4];
        this.group = this.type;
    }
}
class UserDebugLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = this.type + ":" + parts[3] + " " + parts[4];
        this.group = this.type;
    }
}
class CumulativeLimitUsageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["CUMULATIVE_LIMIT_USAGE_END"];
        this.displayType = "method";
        this.cpuType = "system";
        this.timelineKey = "systemMethod";
        this.text = this.type;
        this.group = this.type;
    }
}
class CumulativeLimitUsageEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class CumulativeProfilingLine extends LogLine {
    constructor(parts) {
        var _a;
        super(parts);
        this.acceptsText = true;
        this.text = parts[2] + " " + ((_a = parts[3]) !== null && _a !== void 0 ? _a : "");
    }
}
class CumulativeProfilingBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["CUMULATIVE_PROFILING_END"];
    }
}
class CumulativeProfilingEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class LimitUsageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[3] + " " + parts[4] + " out of " + parts[5];
        this.group = this.type;
    }
}
class LimitUsageForNSLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
        this.text = parts[2];
        this.group = this.type;
    }
    after(next) {
        const matched = this.text.match(/Maximum CPU time: (\d+)/), cpuText = matched ? matched[1] : "0", cpuTime = parseInt(cpuText, 10) * 1000000; // convert from milli-seconds to nano-seconds
        if (!cpuUsed || cpuTime > cpuUsed) {
            cpuUsed = cpuTime;
        }
    }
}
class PushTraceFlagsLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[4] + ", line:" + this.lineNumber + " - " + parts[5];
    }
}
class PopTraceFlagsLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[4] + ", line:" + this.lineNumber + " - " + parts[5];
    }
}
class QueryMoreBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["QUERY_MORE_END"];
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = `line: ${this.lineNumber}`;
    }
}
class QueryMoreEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = `line: ${this.lineNumber}`;
    }
}
class QueryMoreIterationsLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
    }
}
class SavepointRollbackLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = `${parts[3]}, line: ${this.lineNumber}`;
    }
}
class SavepointSetLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = `${parts[3]}, line: ${this.lineNumber}`;
    }
}
class TotalEmailRecipientsQueuedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class StackFrameVariableListLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
    }
}
class StaticVariableListLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
    }
}
class SystemModeEnterLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.text = parts[2];
    }
}
class SystemModeExitLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.namespace = "system";
        this.timelineKey = "systemMethod";
        this.text = parts[2];
    }
}
class ExecutionStartedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["EXECUTION_FINISHED"];
        this.displayType = "method";
        this.timelineKey = "method";
        this.classes = "node";
        this.text = this.type;
    }
}

class ExecutionFinishedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.text = this.type;
    }
}

class EnteringManagedPackageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.displayType = "method";
        this.cpuType = "pkg";
        this.timelineKey = "method";
        const rawNs = parts[2], lastDot = rawNs.lastIndexOf("."), ns = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);
        this.text = this.namespace = ns;
    }
    after(next) {
        this.exitStamp = next.timestamp;
        this.duration = this.selfTime = this.exitStamp - this.timestamp;
    }
}
class EventSericePubBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["EVENT_SERVICE_PUB_END"];
        this.displayType = "method";
        this.cpuType = "custom";
        this.timelineKey = "flow";
        this.group = this.type;
        this.text = parts[2];
    }
}
class EventSericePubEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.text = parts[2];
    }
}
class EventSericePubDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2] + " " + parts[3] + " " + parts[4];
        this.group = this.type;
    }
}
class EventSericeSubBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["EVENT_SERVICE_SUB_END"];
        this.displayType = "method";
        this.cpuType = "custom";
        this.timelineKey = "flow";
        this.text = `${parts[2]} ${parts[3]}`;
        this.group = this.type;
    }
}
class EventSericeSubEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
        this.text = `${parts[2]} ${parts[3]}`;
    }
}
class EventSericeSubDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[6]} ${parts[6]}`;
        this.group = this.type;
    }
}
class SavePointSetLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = parts[3];
    }
}
class FlowStartInterviewsBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["FLOW_START_INTERVIEWS_END"];
        this.displayType = "method";
        this.cpuType = "custom";
        this.declarative = true;
        this.timelineKey = "flow";
        this.group = "FLOW_START_INTERVIEWS";
        this.text = "FLOW_START_INTERVIEWS : " + parts[2];
    }
    onEnd(end) {
        if (this.children) {
            let interviewBegin = this.children[0];
            if (interviewBegin.displayType === "block" && interviewBegin.children) {
                interviewBegin = interviewBegin.children[0];
            }
            this.text += " - " + interviewBegin.text;
        }
    }
}
class FlowStartInterviewsEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class FlowStartInterviewsErrorLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} - ${parts[4]}`;
    }
}
class FlowStartInterviewBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[3];
        this.group = this.type;
    }
}
class FlowStartInterviewEndLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class FlowStartInterviewLimitUsageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
        this.group = this.type;
    }
}
class FlowStartScheduledRecordsLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]}`;
    }
}
class FlowCreateInterviewBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = "";
    }
}
class FlowCreateInterviewEndLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class FlowCreateInterviewErrorLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
}
class FlowElementBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["FLOW_ELEMENT_END"];
        this.displayType = "method";
        this.cpuType = "custom";
        this.declarative = true;
        this.timelineKey = "flow";
        this.group = this.type;
        this.text = this.type + " - " + parts[3] + " " + parts[4];
    }
}
class FlowElementEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class FlowElementDeferredLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.declarative = true;
        this.text = parts[2] + " " + parts[3];
        this.group = this.type;
    }
}
class FlowElementAssignmentLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.declarative = true;
        this.text = parts[3] + " " + parts[4];
        this.group = this.type;
    }
}
class FlowWaitEventResumingDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
}
class FlowWaitEventWaitingDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
    }
}
class FlowWaitResumingDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class FlowWaitWaitingDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
}
class FlowInterviewFinishedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[3];
        this.group = this.type;
    }
}
class FlowInterviewResumedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]}`;
    }
}
class FlowInterviewPausedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class FlowElementErrorLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[1] + parts[2] + " " + parts[3] + " " + parts[4];
    }
}
class FlowElementFaultLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class FlowElementLimitUsageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}`;
    }
}
class FlowInterviewFinishedLimitUsageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}`;
    }
}
class FlowSubflowDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
}
class FlowActionCallDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text =
            parts[3] + " : " + parts[4] + " : " + parts[5] + " : " + parts[6];
        this.group = this.type;
    }
}
class FlowAssignmentDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[3] + " : " + parts[4] + " : " + parts[5];
        this.group = this.type;
    }
}
class FlowLoopDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[3] + " : " + parts[4];
        this.group = this.type;
    }
}
class FlowRuleDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[3] + " : " + parts[4];
        this.group = this.type;
    }
}
class FlowBulkElementBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["FLOW_BULK_ELEMENT_END"];
        this.displayType = "method";
        this.cpuType = "custom";
        this.declarative = true;
        this.timelineKey = "flow";
        this.text = this.type + " - " + parts[2];
        this.group = this.type;
    }
}
class FlowBulkElementEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class FlowBulkElementDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.declarative = true;
        this.text = parts[2] + " : " + parts[3] + " : " + parts[4];
        this.group = this.type;
    }
}
class FlowBulkElementNotSupportedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class FlowBulkElementLimitUsageLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.declarative = true;
        this.text = parts[2];
        this.group = this.type;
    }
}
class PNInvalidAppLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}.${parts[3]}`;
    }
}
class PNInvalidCertificateLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}.${parts[3]}`;
    }
}
class PNInvalidNotificationLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]} : ${parts[8]}`;
    }
}
class PNNoDevicesLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}.${parts[3]}`;
    }
}
class PNNotEnabledLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class PNSentLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
    }
}
class SLAEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
    }
}
class SLAEvalMilestoneLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}`;
    }
}
class SLANullStartDateLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class SLAProcessCaseLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}`;
    }
}
class TestingLimitsLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
    }
}
class ValidationRuleLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[3];
        this.group = this.type;
    }
}
class ValidationErrorLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class ValidationFailLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class ValidationFormulaLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
        const extra = parts.length > 3 ? " " + parts[3] : "";
        this.text = parts[2] + extra;
        this.group = this.type;
    }
}
class ValidationPassLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[3];
        this.group = this.type;
    }
}
class WFFlowActionBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class WFFlowActionEndLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class WFFlowActionErrorLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[1] + " " + parts[4];
    }
}
class WFFlowActionErrorDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[1] + " " + parts[2];
    }
}
class WFFieldUpdateLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text =
            " " +
                parts[2] +
                " " +
                parts[3] +
                " " +
                parts[4] +
                " " +
                parts[5] +
                " " +
                parts[6];
        this.group = this.type;
    }
}
class WFRuleEvalBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["WF_RULE_EVAL_END"];
        this.displayType = "method";
        this.cpuType = "custom";
        this.declarative = true;
        this.timelineKey = "workflow";
        this.text = this.type;
    }
}
class WFRuleEvalEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class WFRuleEvalValueLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
        this.group = this.type;
    }
}
class WFRuleFilterLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
        this.text = parts[2];
        this.group = this.type;
    }
}
class WFRuleNotEvaluatedLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class WFCriteriaBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.exitTypes = ["WF_CRITERIA_END", "WF_RULE_NOT_EVALUATED"];
        this.displayType = "method";
        this.cpuType = "custom";
        this.declarative = true;
        this.timelineKey = "workflow";
        this.group = "WF_CRITERIA";
        this.text = "WF_CRITERIA : " + parts[5] + " : " + parts[3];
    }
}
class WFCriteriaEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.isExit = true;
    }
}
class WFFormulaLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
        this.text = parts[2] + " : " + parts[3];
        this.group = this.type;
    }
}
class WFActionLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
        this.group = this.type;
    }
}
class WFActionsEndLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class WFActionTaskLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
    }
}
class WFApprovalLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class WFApprovalRemoveLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}`;
    }
}
class WFApprovalSubmitLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]}`;
    }
}
class WFApprovalSubmitterLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class WFAssignLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]}`;
    }
}
class WFEmailAlertLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class WFEmailSentLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class WFEnqueueActionsLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class WFEscalationActionLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]}`;
    }
}
class WFEscalationRuleLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class WFEvalEntryCriteriaLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class WFFlowActionDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : "";
        this.text = `${parts[2]} : ${parts[3]}` + optional;
    }
}
class WFHardRejectLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class WFNextApproverLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
}
class WFNoProcessFoundLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class WFOutboundMsgLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
}
class WFProcessFoundLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]}`;
    }
}
class WFReassignRecordLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]}`;
    }
}
class WFResponseNotifyLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
}
class WFRuleEntryOrderLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class WFRuleInvocationLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class WFSoftRejectLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class WFTimeTriggerLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
}
class WFSpoolActionBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class WFTimeTriggersBeginLine extends LogLine {
    constructor(parts) {
        super(parts);
    }
}
class ExceptionThrownLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.discontinuity = true;
        const text = parts[3];
        if (text.indexOf("System.LimitException") >= 0) {
            truncateLog(this.timestamp, text, "error");
        }
        this.lineNumber = parseLineNumber(parts[2]);
        this.text = text;
        this.group = this.type;
    }
}
class FatalErrorLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.acceptsText = true;
        this.hideable = false;
        this.discontinuity = true;
        truncateLog(this.timestamp, "FATAL ERROR! cause=" + parts[2], "error");
        this.text = parts[2];
    }
}
class XDSDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class XDSResponseLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
    }
}
class XDSResponseDetailLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
class XDSResponseErrorLine extends LogLine {
    constructor(parts) {
        super(parts);
        this.text = parts[2];
    }
}
const lineTypeMap = new Map([
    ["BULK_HEAP_ALLOCATE", BulkHeapAllocateLine],
    ["CALLOUT_REQUEST", CalloutRequestLine],
    ["CALLOUT_RESPONSE", CalloutResponseLine],
    ["NAMED_CREDENTIAL_REQUEST", NamedCredentialRequestLine],
    ["NAMED_CREDENTIAL_RESPONSE", NamedCredentialResponseLine],
    ["NAMED_CREDENTIAL_RESPONSE_DETAIL", NamedCredentialResponseDetailLine],
    ["CONSTRUCTOR_ENTRY", ConstructorEntryLine],
    ["CONSTRUCTOR_EXIT", ConstructorExitLine],
    ["EMAIL_QUEUE", EmailQueueLine],
    ["METHOD_ENTRY", MethodEntryLine],
    ["METHOD_EXIT", MethodExitLine],
    ["SYSTEM_CONSTRUCTOR_ENTRY", SystemConstructorEntryLine],
    ["SYSTEM_CONSTRUCTOR_EXIT", SystemConstructorExitLine],
    ["SYSTEM_METHOD_ENTRY", SystemMethodEntryLine],
    ["SYSTEM_METHOD_EXIT", SystemMethodExitLine],
    ["CODE_UNIT_STARTED", CodeUnitStartedLine],
    ["CODE_UNIT_FINISHED", CodeUnitFinishedLine],
    ["VF_APEX_CALL_START", VFApexCallStartLine],
    ["VF_APEX_CALL_END", VFApexCallEndLine],
    ["VF_DESERIALIZE_VIEWSTATE_BEGIN", VFDeserializeViewstateBeginLine],
    ["VF_DESERIALIZE_VIEWSTATE_END", VFDeserializeViewstateEndLine],
    ["VF_EVALUATE_FORMULA_BEGIN", VFFormulaStartLine],
    ["VF_EVALUATE_FORMULA_END", VFFormulaEndLine],
    ["VF_SERIALIZE_VIEWSTATE_BEGIN", VFSeralizeViewStateStartLine],
    ["VF_SERIALIZE_VIEWSTATE_END", VFSeralizeViewStateEndLine],
    ["VF_PAGE_MESSAGE", VFPageMessageLine],
    ["DML_BEGIN", DMLBeginLine],
    ["DML_END", DMLEndLine],
    ["IDEAS_QUERY_EXECUTE", IdeasQueryExecuteLine],
    ["SOQL_EXECUTE_BEGIN", SOQLExecuteBeginLine],
    ["SOQL_EXECUTE_END", SOQLExecuteEndLine],
    ["SOQL_EXECUTE_EXPLAIN", SOQLExecuteExplainLine],
    ["SOSL_EXECUTE_BEGIN", SOSLExecuteBeginLine],
    ["SOSL_EXECUTE_END", SOSLExecuteEndLine],
    ["HEAP_ALLOCATE", HeapAllocateLine],
    ["HEAP_DEALLOCATE", HeapDeallocateLine],
    ["STATEMENT_EXECUTE", StatementExecuteLine],
    ["VARIABLE_SCOPE_BEGIN", VariableScopeBeginLine],
    ["VARIABLE_SCOPE_END", VariableScopeEndLine],
    ["VARIABLE_ASSIGNMENT", VariableAssignmentLine],
    ["USER_INFO", UserInfoLine],
    ["USER_DEBUG", UserDebugLine],
    ["CUMULATIVE_LIMIT_USAGE", CumulativeLimitUsageLine],
    ["CUMULATIVE_LIMIT_USAGE_END", CumulativeLimitUsageEndLine],
    ["CUMULATIVE_PROFILING", CumulativeProfilingLine],
    ["CUMULATIVE_PROFILING_BEGIN", CumulativeProfilingBeginLine],
    ["CUMULATIVE_PROFILING_END", CumulativeProfilingEndLine],
    ["LIMIT_USAGE", LimitUsageLine],
    ["LIMIT_USAGE_FOR_NS", LimitUsageForNSLine],
    ["POP_TRACE_FLAGS", PopTraceFlagsLine],
    ["PUSH_TRACE_FLAGS", PushTraceFlagsLine],
    ["QUERY_MORE_BEGIN", QueryMoreBeginLine],
    ["QUERY_MORE_END", QueryMoreEndLine],
    ["QUERY_MORE_ITERATIONS", QueryMoreIterationsLine],
    ["TOTAL_EMAIL_RECIPIENTS_QUEUED", TotalEmailRecipientsQueuedLine],
    ["SAVEPOINT_ROLLBACK", SavepointRollbackLine],
    ["SAVEPOINT_SET", SavepointSetLine],
    ["STACK_FRAME_VARIABLE_LIST", StackFrameVariableListLine],
    ["STATIC_VARIABLE_LIST", StaticVariableListLine],
    ["SYSTEM_MODE_ENTER", SystemModeEnterLine],
    ["SYSTEM_MODE_EXIT", SystemModeExitLine],
    ["EXECUTION_STARTED", ExecutionStartedLine],
    ["EXECUTION_FINISHED", ExecutionFinishedLine],
    ["ENTERING_MANAGED_PKG", EnteringManagedPackageLine],
    ["EVENT_SERVICE_PUB_BEGIN", EventSericePubBeginLine],
    ["EVENT_SERVICE_PUB_END", EventSericePubEndLine],
    ["EVENT_SERVICE_PUB_DETAIL", EventSericePubDetailLine],
    ["EVENT_SERVICE_SUB_BEGIN", EventSericeSubBeginLine],
    ["EVENT_SERVICE_SUB_DETAIL", EventSericeSubDetailLine],
    ["EVENT_SERVICE_SUB_END", EventSericeSubEndLine],
    ["SAVEPOINT_SET", SavePointSetLine],
    ["FLOW_START_INTERVIEWS_BEGIN", FlowStartInterviewsBeginLine],
    ["FLOW_START_INTERVIEWS_END", FlowStartInterviewsEndLine],
    ["FLOW_START_INTERVIEWS_ERROR", FlowStartInterviewsErrorLine],
    ["FLOW_START_INTERVIEW_BEGIN", FlowStartInterviewBeginLine],
    ["FLOW_START_INTERVIEW_END", FlowStartInterviewEndLine],
    ["FLOW_START_INTERVIEW_LIMIT_USAGE", FlowStartInterviewLimitUsageLine],
    ["FLOW_START_SCHEDULED_RECORDS", FlowStartScheduledRecordsLine],
    ["FLOW_CREATE_INTERVIEW_BEGIN", FlowCreateInterviewBeginLine],
    ["FLOW_CREATE_INTERVIEW_END", FlowCreateInterviewEndLine],
    ["FLOW_CREATE_INTERVIEW_ERROR", FlowCreateInterviewErrorLine],
    ["FLOW_ELEMENT_BEGIN", FlowElementBeginLine],
    ["FLOW_ELEMENT_END", FlowElementEndLine],
    ["FLOW_ELEMENT_DEFERRED", FlowElementDeferredLine],
    ["FLOW_ELEMENT_ERROR", FlowElementErrorLine],
    ["FLOW_ELEMENT_FAULT", FlowElementFaultLine],
    ["FLOW_ELEMENT_LIMIT_USAGE", FlowElementLimitUsageLine],
    ["FLOW_INTERVIEW_FINISHED_LIMIT_USAGE", FlowInterviewFinishedLimitUsageLine],
    ["FLOW_SUBFLOW_DETAIL", FlowSubflowDetailLine],
    ["FLOW_VALUE_ASSIGNMENT", FlowElementAssignmentLine],
    ["FLOW_WAIT_EVENT_RESUMING_DETAIL", FlowWaitEventResumingDetailLine],
    ["FLOW_WAIT_EVENT_WAITING_DETAIL", FlowWaitEventWaitingDetailLine],
    ["FLOW_WAIT_RESUMING_DETAIL", FlowWaitResumingDetailLine],
    ["FLOW_WAIT_WAITING_DETAIL", FlowWaitWaitingDetailLine],
    ["FLOW_INTERVIEW_FINISHED", FlowInterviewFinishedLine],
    ["FLOW_INTERVIEW_PAUSED", FlowInterviewPausedLine],
    ["FLOW_INTERVIEW_RESUMED", FlowInterviewResumedLine],
    ["FLOW_ACTIONCALL_DETAIL", FlowActionCallDetailLine],
    ["FLOW_ASSIGNMENT_DETAIL", FlowAssignmentDetailLine],
    ["FLOW_LOOP_DETAIL", FlowLoopDetailLine],
    ["FLOW_RULE_DETAIL", FlowRuleDetailLine],
    ["FLOW_BULK_ELEMENT_BEGIN", FlowBulkElementBeginLine],
    ["FLOW_BULK_ELEMENT_END", FlowBulkElementEndLine],
    ["FLOW_BULK_ELEMENT_DETAIL", FlowBulkElementDetailLine],
    ["FLOW_BULK_ELEMENT_LIMIT_USAGE", FlowBulkElementLimitUsageLine],
    ["FLOW_BULK_ELEMENT_NOT_SUPPORTED", FlowBulkElementNotSupportedLine],
    ["PUSH_NOTIFICATION_INVALID_APP", PNInvalidAppLine],
    ["PUSH_NOTIFICATION_INVALID_CERTIFICATE", PNInvalidCertificateLine],
    ["PUSH_NOTIFICATION_INVALID_NOTIFICATION", PNInvalidNotificationLine],
    ["PUSH_NOTIFICATION_NO_DEVICES", PNNoDevicesLine],
    ["PUSH_NOTIFICATION_NOT_ENABLED", PNNotEnabledLine],
    ["PUSH_NOTIFICATION_SENT", PNSentLine],
    ["SLA_END", SLAEndLine],
    ["SLA_EVAL_MILESTONE", SLAEvalMilestoneLine],
    ["SLA_NULL_START_DATE", SLANullStartDateLine],
    ["SLA_PROCESS_CASE", SLAProcessCaseLine],
    ["TESTING_LIMITS", TestingLimitsLine],
    ["VALIDATION_ERROR", ValidationErrorLine],
    ["VALIDATION_FAIL", ValidationFailLine],
    ["VALIDATION_FORMULA", ValidationFormulaLine],
    ["VALIDATION_PASS", ValidationPassLine],
    ["VALIDATION_RULE", ValidationRuleLine],
    ["WF_FLOW_ACTION_BEGIN", WFFlowActionBeginLine],
    ["WF_FLOW_ACTION_END", WFFlowActionEndLine],
    ["WF_FLOW_ACTION_ERROR", WFFlowActionErrorLine],
    ["WF_FLOW_ACTION_ERROR_DETAIL", WFFlowActionErrorDetailLine],
    ["WF_FIELD_UPDATE", WFFieldUpdateLine],
    ["WF_RULE_EVAL_BEGIN", WFRuleEvalBeginLine],
    ["WF_RULE_EVAL_END", WFRuleEvalEndLine],
    ["WF_RULE_EVAL_VALUE", WFRuleEvalValueLine],
    ["WF_RULE_FILTER", WFRuleFilterLine],
    ["WF_RULE_NOT_EVALUATED", WFRuleNotEvaluatedLine],
    ["WF_CRITERIA_BEGIN", WFCriteriaBeginLine],
    ["WF_CRITERIA_END", WFCriteriaEndLine],
    ["WF_FORMULA", WFFormulaLine],
    ["WF_ACTION", WFActionLine],
    ["WF_ACTIONS_END", WFActionsEndLine],
    ["WF_ACTION_TASK", WFActionTaskLine],
    ["WF_APPROVAL", WFApprovalLine],
    ["WF_APPROVAL_REMOVE", WFApprovalRemoveLine],
    ["WF_APPROVAL_SUBMIT", WFApprovalSubmitLine],
    ["WF_APPROVAL_SUBMITTER", WFApprovalSubmitterLine],
    ["WF_ASSIGN", WFAssignLine],
    ["WF_EMAIL_ALERT", WFEmailAlertLine],
    ["WF_EMAIL_SENT", WFEmailSentLine],
    ["WF_ENQUEUE_ACTIONS", WFEnqueueActionsLine],
    ["WF_ESCALATION_ACTION", WFEscalationActionLine],
    ["WF_ESCALATION_RULE", WFEscalationRuleLine],
    ["WF_EVAL_ENTRY_CRITERIA", WFEvalEntryCriteriaLine],
    ["WF_FLOW_ACTION_DETAIL", WFFlowActionDetailLine],
    ["WF_HARD_REJECT", WFHardRejectLine],
    ["WF_NEXT_APPROVER", WFNextApproverLine],
    ["WF_NO_PROCESS_FOUND", WFNoProcessFoundLine],
    ["WF_OUTBOUND_MSG", WFOutboundMsgLine],
    ["WF_PROCESS_FOUND", WFProcessFoundLine],
    ["WF_REASSIGN_RECORD", WFReassignRecordLine],
    ["WF_RESPONSE_NOTIFY", WFResponseNotifyLine],
    ["WF_RULE_ENTRY_ORDER", WFRuleEntryOrderLine],
    ["WF_RULE_INVOCATION", WFRuleInvocationLine],
    ["WF_SOFT_REJECT", WFSoftRejectLine],
    ["WF_SPOOL_ACTION_BEGIN", WFSpoolActionBeginLine],
    ["WF_TIME_TRIGGER", WFTimeTriggerLine],
    ["WF_TIME_TRIGGERS_BEGIN", WFTimeTriggersBeginLine],
    ["EXCEPTION_THROWN", ExceptionThrownLine],
    ["FATAL_ERROR", FatalErrorLine],
    ["XDS_DETAIL", XDSDetailLine],
    ["XDS_RESPONSE", XDSResponseLine],
    ["XDS_RESPONSE_DETAIL", XDSResponseDetailLine],
    ["XDS_RESPONSE_ERROR", XDSResponseErrorLine],
]);
function parseLine(line, lastEntry) {
    const parts = line.split("|"), type = parts[1], metaCtor = lineTypeMap.get(type);
    if (metaCtor) {
        const entry = new metaCtor(parts);
        entry.logLine = line;
        if (lastEntry === null || lastEntry === void 0 ? void 0 : lastEntry.after) {
            lastEntry === null || lastEntry === void 0 ? void 0 : lastEntry.after(entry);
        }
        return entry;
    }
    else {
        if (!typePattern.test(type) && (lastEntry === null || lastEntry === void 0 ? void 0 : lastEntry.acceptsText)) {
            // wrapped text from the previous entry?
            lastEntry.text += ` | ${line}`;
        }
        else if (type) {
            if (type !== "DUMMY")
                /* Used by tests */
                console.warn(`Unknown log line: ${type}`);
        }
        else {
            if (lastEntry && line.startsWith("*** Skipped")) {
                truncateLog(lastEntry.timestamp, "Skipped-Lines", "skip");
            }
            else if (lastEntry &&
                line.indexOf("MAXIMUM DEBUG LOG SIZE REACHED") >= 0) {
                truncateLog(lastEntry.timestamp, "Max-Size-reached", "skip");
            }
            else {
                console.warn(`Bad log line: ${line}`);
            }
        }
    }
    return null;
}

async function parseLog(log) {
    var _a;
    const start = ((_a = log.match(/^.*EXECUTION_STARTED.*$/m)) === null || _a === void 0 ? void 0 : _a.index) || -1;
    const rawLines = log.substring(start).split("\n");
    // reset global variables to be captured during parsing
    logLines = [];
    truncated = [];
    reasons = new Set();
    cpuUsed = 0;
    let lastEntry = null;
    const len = rawLines.length;
    for (let i = 0; i < len; ++i) {
        const line = rawLines[i];
        if (line) {
            // ignore blank lines
            const entry = parseLine(line, lastEntry);
            if (entry) {
                entry.logLineNumber = i;
                logLines.push(entry);
                lastEntry = entry;
            }
        }
    }

    return {
        logLines,
        truncated,
        reasons,
        cpuUsed,
    };
}

const settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;
function getLogSettings(log) {
    const match = log.match(settingsPattern);
    if (!match) {
        return [];
    }
    const settings = match[0], settingList = settings.substring(settings.indexOf(" ") + 1).split(";");
    return settingList.map((entry) => {
        const parts = entry.split(",");
        return [parts[0], parts[1]];
    });
}

function recalculateDurations(node) {
    if (node.exitStamp) {
        node.selfTime = node.duration = node.exitStamp - node.timestamp;
        if (node.children) {
            const len = node.children.length;
            for (let i = 0; i < len; ++i) {
                const duration = node.children[i].duration;
                if (duration) {
                    node.selfTime -= duration;
                }
            }
        }
    }
}

let lastTimestamp = null, discontinuity = false;
class LineIterator {
    constructor(lines) {
        this.lines = lines;
        this.index = 0;
    }
    peek() {
        return this.index < this.lines.length ? this.lines[this.index] : null;
    }
    fetch() {
        return this.index < this.lines.length ? this.lines[this.index++] : null;
    }
}

class RootNode extends BlockLines {
    constructor() {
        super(...arguments);
        this.text = "Log Root";
        this.type = "ROOT";
        this.timestamp = 0;
    }
}

function endMethod(method, endLine, lineIter) {
    method.exitStamp = endLine.timestamp;
    if (method.onEnd) {
        // the method wants to see the exit line
        method.onEnd(endLine);
    }
    // is this a 'good' end line?
    if (method.exitTypes &&
        method.exitTypes.includes(endLine.type) &&
        (!method.lineNumber || endLine.lineNumber === method.lineNumber)) {
        discontinuity = false; // end stack unwinding
        lineIter.fetch(); // consume the line
    }
    else {
        if (!discontinuity) {
            // discontinuities should have been reported already
            truncateLog(endLine.timestamp, "Unexpected-Exit", "unexpected");
        }
    }
}
function getMethod(lineIter, method) {
    lastTimestamp = method.timestamp;
    if (method.exitTypes) {
        let lines = [], line;
        while ((line = lineIter.peek())) {
            // eslint-disable-line no-cond-assign
            if (line.discontinuity) {
                // discontinuities are stack unwinding (caused by Exceptions)
                discontinuity = true; // start unwinding stack
            }
            if (line.isExit) {
                break;
            }
            lineIter.fetch(); // it's a child - consume the line
            lastTimestamp = line.timestamp;
            if (line.exitTypes || line.displayType === "method") {
                method.addBlock(lines);
                lines = [];
                method.addChild(getMethod(lineIter, line));
            }
            else {
                lines.push(line);
            }
        }
        if (line === null) {
            // truncated method - terminate at the end of the log
            method.exitStamp = lastTimestamp;
            method.duration = lastTimestamp - method.timestamp;
            truncateLog(lastTimestamp, "Unexpected-End", "unexpected");
        }
        if (lines.length) {
            method.addBlock(lines);
        }
        if (line === null || line === void 0 ? void 0 : line.isExit) {
            endMethod(method, line, lineIter);
        }
    }
    recalculateDurations(method);
    return method;
}

let globalId = 0;

function trimObject(obj) {
    if(Array.isArray(obj)) {
        obj.forEach(trimObject);
    }
    else if(obj && typeof obj === 'object' && obj.constructor === Object) {
        Object.keys(obj).forEach(key => {
            if(!obj[key]) {
                delete obj[key];
            }
            else {
                trimObject(obj[key]);
            }
        });

        obj.id = globalId++;
    }
}

function moderateJSON(obj) {
    globalId = 0;

    const json = JSON.parse(JSON.stringify(obj));
    trimObject(json);

    return json;
}

async function parse(log) {
    await parseLog(log);
    const lineIter = new LineIterator(logLines), rootMethod = new RootNode([]);
    let lines = [], line;
    while ((line = lineIter.fetch())) {
        // eslint-disable-line no-cond-assign
        if (line.exitTypes) {
            rootMethod.addBlock(lines);
            lines = [];
            rootMethod.addChild(getMethod(lineIter, line));
        }
        else {
            lines.push(line);
        }
    }
    rootMethod.addBlock(lines);
    return moderateJSON(rootMethod);
}
module.exports = parse;
