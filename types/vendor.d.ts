declare module "@sabaki/sgf" {
  export interface SgfNode {
    id: number;
    data: Record<string, string[]>;
    parentId: number | null;
    children: SgfNode[];
  }
  export function parse(contents: string, options?: object): SgfNode[];
  export function stringify(nodes: SgfNode[]): string;
}

declare module "@sabaki/go-board" {
  type Vertex = [number, number];
  class GoBoard {
    signMap: number[][];
    width: number;
    height: number;
    constructor(signMap?: number[][]);
    static fromDimensions(width: number, height?: number): GoBoard;
    get(vertex: Vertex): number;
    set(vertex: Vertex, sign: number): GoBoard;
    makeMove(
      sign: number,
      vertex: Vertex,
      options?: {
        preventOverwrite?: boolean;
        preventSuicide?: boolean;
        preventKo?: boolean;
      }
    ): GoBoard;
  }
  export default GoBoard;
}
