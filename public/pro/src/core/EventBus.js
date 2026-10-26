// Bus de eventos mínimo: la simulación emite, y audio / comentarios / interfaz escuchan.

export class EventBus {
  constructor() {
    this.map = new Map();
  }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, []);
    this.map.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const l = this.map.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  emit(type, data) {
    const l = this.map.get(type);
    if (l) for (let i = 0; i < l.length; i++) l[i](data, type);
    const any = this.map.get('*');
    if (any) for (let i = 0; i < any.length; i++) any[i](data, type);
  }
  clear() {
    this.map.clear();
  }
}
