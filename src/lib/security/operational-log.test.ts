import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { operationalErrorFields, recipientLogFields, safeStatusErrorText } from './operational-log';

const privateValues = ['5585998765432','fixture@example.invalid','Private Fixture Name',
  'fictitious-secret', 'fictitious-ctwa-clid', 'a'.repeat(64)];
describe('operational logs are closed-vocabulary, not raw error forwarding', () => {
  it('rejects arbitrary secret/PII-shaped messages, names, codes, details and stacks', () => {
    for (const value of privateValues) {
      const output = JSON.stringify(operationalErrorFields({name:value, code:value,
        message:value, details:value, stack:value, payload:{Authorization:value}}));
      expect(output).not.toContain(value);
      expect(safeStatusErrorText(value)).toBe('[REDACTED]');
    }
    expect(operationalErrorFields({name:'TimeoutError',code:'08006',message:privateValues.join(' ')}))
      .toEqual({error_kind:'TimeoutError',error_code:'08006'});
    expect(operationalErrorFields(new Error('(#131030) '+privateValues.join(' '))))
      .toEqual({error_kind:'operation_failed',error_code:131030});
    expect(safeStatusErrorText('Message undeliverable')).toBe('Message undeliverable');
  });
  it('recipient logs contain only a digit count and suffix', () => {
    expect(recipientLogFields('+55 (85) 99876-5432')).toEqual({recipient_digit_count:13,recipient_last4:'5432'});
    expect(recipientLogFields(undefined)).toEqual({recipient_digit_count:0,recipient_last4:''});
  });
  it('project console calls never forward raw error/message arguments or payload JSON', () => {
    const violations:string[]=[];
    for (const root of ['src']) {
      for (const relative of readdirSync(resolve(root),{recursive:true}) as string[]) {
        if (!/\.tsx?$/.test(relative) || /\.test\./.test(relative)) continue;
        const file=resolve(root,relative), text=readFileSync(file,'utf8');
        const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
        function visit(node:ts.Node) {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
            node.expression.expression.getText(source)==='console') {
            for (const arg of node.arguments) {
              if (ts.isIdentifier(arg) && /^(?:err(?:or)?|\w*(?:Err|Error)|message|registrationError|reason)$/.test(arg.text)
                || ts.isPropertyAccessExpression(arg) && arg.name.text==='message'
                || ts.isConditionalExpression(arg) && arg.getText(source).includes('instanceof Error')
                || ts.isObjectLiteralExpression(arg) && /\.(?:message|details|hint)\b/.test(arg.getText(source))
                || ts.isObjectLiteralExpression(arg) && /String\(error\.code\)/.test(arg.getText(source))
                || /JSON\.stringify\((?:payload|userData|user_data)\)/.test(arg.getText(source))) {
                violations.push(`${file}:${source.getLineAndCharacterOfPosition(arg.getStart()).line+1}`);
              }
            }
          }
          ts.forEachChild(node,visit);
        }
        visit(source);
      }
    }
    expect(violations).toEqual([]);
  });
});
