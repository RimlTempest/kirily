/**
 * Kirily project lint plugin.
 *
 * These rules make the team coding rules mechanically enforceable instead of
 * relying on reviewers (or an agent) remembering them. See
 * `.claude/skills/kirily-typescript/SKILL.md` for the rationale behind each rule.
 */

/** @param {import('estree').Node} node */
const isAsConst = (node) =>
  node.typeAnnotation?.type === 'TSTypeReference'
  && node.typeAnnotation.typeName?.type === 'Identifier'
  && node.typeAnnotation.typeName.name === 'const'

const noClass = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow classes. Model behaviour with functions and pass collaborators as arguments (function DI).',
    },
    messages: {
      noClass:
        'class is not allowed. Use a factory function returning an object of closures, and inject collaborators as parameters (DIP).',
    },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'noClass' })
    return {
      ClassDeclaration: report,
      ClassExpression: report,
      TSAbstractClassDeclaration: report,
    }
  },
}

const noTypeAssertion = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow type assertions. Narrow with type guards / discriminated unions, or validate at the boundary.',
    },
    messages: {
      noAs: '`as` is not allowed (except `as const`). Narrow with a type guard, a discriminated union, or a parse function that returns Result.',
      noAngle: 'Angle-bracket type assertions are not allowed.',
      noNonNull: '`!` non-null assertion is not allowed. Handle the absent case explicitly.',
    },
  },
  create(context) {
    return {
      TSAsExpression(node) {
        if (isAsConst(node)) return
        context.report({ node, messageId: 'noAs' })
      },
      TSTypeAssertion(node) {
        context.report({ node, messageId: 'noAngle' })
      },
      TSNonNullExpression(node) {
        context.report({ node, messageId: 'noNonNull' })
      },
    }
  },
}

const noEnum = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow enum. Use a const object + union of its values, or a discriminated union.',
    },
    messages: {
      noEnum:
        'enum is not allowed. Use `const X = {...} as const` with `type X = (typeof X)[keyof typeof X]`, or a discriminated union.',
    },
  },
  create(context) {
    return {
      TSEnumDeclaration(node) {
        context.report({ node, messageId: 'noEnum' })
      },
    }
  },
}

const noThrowInDomain = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `throw` in domain code. Domain failures are values: return Result<T, E>.',
    },
    messages: {
      noThrow:
        '`throw` is not allowed here. Return `err(...)` from a Result-returning function so callers must handle the failure.',
    },
  },
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({ node, messageId: 'noThrow' })
      },
    }
  },
}

/**
 * Editor core / image core must run in a Worker and in a test with no DOM.
 * Reaching for a browser global there is what makes pixel code untestable and
 * pins it to the main thread — the exact thing Kirily's architecture avoids.
 */
const DOM_GLOBALS = new Set([
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'Image',
  'fetch',
])

const noDomInCore = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow DOM globals in DOM-free packages. Pass buffers in, return buffers out; the app owns the canvas.',
    },
    messages: {
      noDom:
        '`{{name}}` is a DOM global and must not appear here. This code has to run inside a Worker and in a DOM-free unit test: take pixel buffers as parameters and let the app layer own the canvas.',
    },
  },
  create(context) {
    const isShadowed = (name) => {
      let scope = context.sourceCode?.getScope?.(context.sourceCode.ast)
      while (scope) {
        if (scope.variables?.some((v) => v.name === name && v.defs?.length > 0)) return true
        scope = scope.upper
      }
      return false
    }
    return {
      Identifier(node) {
        if (!DOM_GLOBALS.has(node.name)) return
        const parent = node.parent
        // Only flag value references, not `foo.document` / `{ document: 1 }` / type positions.
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed)
          return
        if (parent?.type === 'Property' && parent.key === node && !parent.computed) return
        if (parent?.type === 'TSTypeReference' || parent?.type === 'TSQualifiedName') return
        if (isShadowed(node.name)) return
        context.report({ node, messageId: 'noDom', data: { name: node.name } })
      },
    }
  },
}

export default {
  meta: { name: 'kirily' },
  rules: {
    'no-class': noClass,
    'no-type-assertion': noTypeAssertion,
    'no-enum': noEnum,
    'no-throw-in-domain': noThrowInDomain,
    'no-dom-in-core': noDomInCore,
  },
}
