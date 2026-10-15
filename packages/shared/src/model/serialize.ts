import * as Y from 'yjs';

/** 序列化後的 Yjs 內容：純 JSON，可以重新建立成同樣結構的 Y 型別 */
export type SerializedValue =
  | null
  | boolean
  | number
  | string
  | SerializedValue[]
  | { [k: string]: SerializedValue }
  | { __yfrag: SerializedXml[] }
  | { __ymap: Record<string, SerializedValue> }
  | { __yarr: SerializedValue[] };

export type SerializedXml =
  | { t: 'text'; delta: { insert: string; attributes?: Record<string, unknown> }[] }
  | { t: 'el'; name: string; attrs: Record<string, unknown>; children: SerializedXml[] };

function serializeXml(node: Y.XmlElement | Y.XmlText): SerializedXml {
  if (node instanceof Y.XmlText) {
    return { t: 'text', delta: (node.toDelta() as any[]).filter((d) => typeof d.insert === 'string') };
  }
  return {
    t: 'el',
    name: node.nodeName,
    attrs: node.getAttributes() as Record<string, unknown>,
    children: node.toArray().map((c) => serializeXml(c as Y.XmlElement | Y.XmlText)),
  };
}

export function serializeValue(v: unknown): SerializedValue {
  if (v instanceof Y.XmlFragment && !(v instanceof Y.XmlElement)) {
    return { __yfrag: v.toArray().map((c) => serializeXml(c as Y.XmlElement | Y.XmlText)) };
  }
  if (v instanceof Y.Map) {
    const out: Record<string, SerializedValue> = {};
    v.forEach((val, k) => (out[k] = serializeValue(val)));
    return { __ymap: out };
  }
  if (v instanceof Y.Array) return { __yarr: v.toArray().map(serializeValue) };
  if (v === undefined) return null;
  return JSON.parse(JSON.stringify(v)) as SerializedValue;
}

function buildXml(s: SerializedXml): Y.XmlElement | Y.XmlText {
  if (s.t === 'text') {
    const t = new Y.XmlText();
    t.applyDelta(s.delta);
    return t;
  }
  const el = new Y.XmlElement(s.name);
  for (const [k, v] of Object.entries(s.attrs ?? {})) el.setAttribute(k, v as any);
  el.insert(
    0,
    (s.children ?? []).map((c) => buildXml(c)),
  );
  return el;
}

export function deserializeValue(v: SerializedValue): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('__yfrag' in v && Array.isArray((v as any).__yfrag)) {
      const f = new Y.XmlFragment();
      f.insert(0, ((v as any).__yfrag as SerializedXml[]).map(buildXml));
      return f;
    }
    if ('__ymap' in v) {
      const m = new Y.Map<any>();
      for (const [k, val] of Object.entries((v as any).__ymap as Record<string, SerializedValue>)) m.set(k, deserializeValue(val));
      return m;
    }
    if ('__yarr' in v) return Y.Array.from(((v as any).__yarr as SerializedValue[]).map(deserializeValue) as any[]);
  }
  return v;
}

export function serializeObjectMap(m: Y.Map<any>): Record<string, SerializedValue> {
  const out: Record<string, SerializedValue> = {};
  m.forEach((val, k) => (out[k] = serializeValue(val)));
  return out;
}

export function buildObjectMap(s: Record<string, SerializedValue>): Y.Map<any> {
  const m = new Y.Map<any>();
  for (const [k, v] of Object.entries(s)) m.set(k, deserializeValue(v));
  return m;
}
