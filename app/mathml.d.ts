import type { HTMLAttributes } from "react";

type MathMLElementProps = HTMLAttributes<MathMLElement>;
type MathRootProps = MathMLElementProps & { display?: "block" | "inline" };

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathRootProps;
      mfrac: MathMLElementProps;
      mi: MathMLElementProps;
      mn: MathMLElementProps;
      mo: MathMLElementProps;
      mrow: MathMLElementProps;
      msub: MathMLElementProps;
      msup: MathMLElementProps;
      mtext: MathMLElementProps;
    }
  }
}

export {};
