import {
  isElement,
  isFragment,
  isComponent,
  isExpression,
  parseJSX,
  rootUnshift,
  registerImportMethod,
  type ElementInfo,
  type ComponentInfo,
  type Static,
} from '@actual-dom/babel-utils';
import { isEvent, getEventName, SVGElements, Text } from '@actual-dom/shared';
import config, { type Config } from './config';
import {
  callExpression,
  arrowFunctionExpression,
  expressionStatement,
  variableDeclaration,
  variableDeclarator,
  stringLiteral,
  blockStatement,
  returnStatement,
  valueToNode,
  objectExpression,
  objectProperty,
  identifier,
  spreadElement,
  arrayExpression,
  nullLiteral,
  type ObjectProperty,
  type SpreadElement,
  type Statement,
  type Identifier,
  type CallExpression,
  booleanLiteral,
} from '@babel/types';

const actualDOM = 'actual-dom';
const shared = '@actual-dom/shared';
const template = 'template';
const createElement = 'createElement';
const on = 'on';
const setProp = 'setProp';
const setProps = 'setProps';
const getChild = 'getChild';
const appendChild = 'appendChild';
const createText = 'createText';
const createComment = 'createComment';
const createFragment = 'createFragment';
const createComponent = 'createComponent';
const Comment = 'Comment';

const createElementAST = (path: any, info: ElementInfo, config: Config) => {
  const importActualDOM = (name: string) => registerImportMethod(path, name, actualDOM);
  const importShared = (name: string) => registerImportMethod(path, name, shared);

  const createElID = path.scope.generateUidIdentifier('_createEl');
  const el = path.scope.generateUidIdentifier('_el');
  const createElements = ({ type, props, children }: Static): CallExpression =>
    typeof type === 'string'
      ? callExpression(importActualDOM(createElement), [
          stringLiteral(type),
          objectExpression(
            props.reduce(
              (objectProps, [key, value]) => {
                objectProps.push(objectProperty(identifier(key), stringLiteral(value)));
                return objectProps;
              },
              [] as (ObjectProperty | SpreadElement)[],
            ),
          ),
          arrayExpression(
            children.map(child =>
              typeof child === 'string'
                ? stringLiteral(child)
                : child.type === Comment
                ? nullLiteral()
                : createElements(child),
            ),
          ),
          ...(SVGElements.includes(type) ? [booleanLiteral(true)] : []),
        ])
      : callExpression(
          importActualDOM(type === Text ? createText : createComment),
          type === Text ? [stringLiteral(children[0] as string)] : [],
        );

  config.template &&
    rootUnshift(
      path,
      variableDeclaration('const', [
        variableDeclarator(
          createElID,
          callExpression(importActualDOM(template), [
            stringLiteral(info.static.toString(config.template)),
          ]),
        ),
      ]),
    );

  return callExpression(
    arrowFunctionExpression(
      [],
      blockStatement([
        variableDeclaration('const', [
          variableDeclarator(
            el,
            config.template ? callExpression(createElID, []) : createElements(info.static),
          ),
        ]),
        ...info.dynamic.reduce((statementArr, [item, indexArr]) => {
          const element = indexArr.length
            ? callExpression(importActualDOM(getChild), [el, valueToNode(indexArr)])
            : el;
          if (Array.isArray(item)) {
            item.forEach(({ key, value }) =>
              statementArr.push(
                expressionStatement(
                  callExpression(
                    importActualDOM(value ? (isEvent(key) ? on : setProp) : setProps),
                    [
                      element,
                      ...(value
                        ? [stringLiteral(isEvent(key) ? getEventName(key) : key), value]
                        : [key]),
                    ],
                  ),
                ),
              ),
            );
          } else {
            if (isExpression(item)) {
              statementArr.push(
                expressionStatement(
                  callExpression(importActualDOM(appendChild), [item.value, element]),
                ),
              );
            } else if (isComponent(item)) {
              statementArr.push(
                expressionStatement(
                  callExpression(importActualDOM(appendChild), [
                    createComponentAST(item, importActualDOM, importShared),
                    element,
                  ]),
                ),
              );
            }
          }
          return statementArr;
        }, [] as Statement[]),
        returnStatement(el),
      ]),
    ),
    [],
  );
};

const createComponentAST = (
  info: ComponentInfo,
  importActualDOM: (name: string) => Identifier,
  importShared: (name: string) => Identifier,
) =>
  callExpression(importActualDOM(createComponent), [
    info.tag,
    objectExpression(
      info.dynamic.props.reduce(
        (objectProps, { key, value }) => {
          objectProps.push(
            value
              ? objectProperty(
                  identifier(key),
                  typeof value === 'string' ? stringLiteral(value) : value,
                )
              : spreadElement(key),
          );
          return objectProps;
        },
        info.static.props.reduce(
          (objectProps, [key, value]) => {
            objectProps.push(objectProperty(identifier(key), stringLiteral(value)));
            return objectProps;
          },
          [] as (ObjectProperty | SpreadElement)[],
        ),
      ),
    ),
    arrayExpression(
      info.dynamic.children
        .reduce(
          (children, [child, index]) => {
            isExpression(child) && (children[index] = child.value);
            return children;
          },
          info.static.children.reduce((children, [child, index]) => {
            children[index] = Array.isArray(child)
              ? arrayExpression(
                  child.reduce((comments, comment) => {
                    comments.push(
                      objectExpression([
                        objectProperty(stringLiteral('type'), importShared(Comment)),
                        objectProperty(stringLiteral('value'), stringLiteral(comment)),
                      ]),
                    );
                    return comments;
                  }, []),
                )
              : stringLiteral(child);
            return children;
          }, [] as any[]),
        )
        .filter(item => item),
    ),
  ]);

export default (path: any, { opts }: { opts: Config }) => {
  const importActualDOM = (name: string) => registerImportMethod(path, name, actualDOM);
  const importShared = (name: string) => registerImportMethod(path, name, shared);
  const configuration = Object.assign(config, opts);
  const info = parseJSX(path, configuration);
  if (isElement(info)) {
    path.replaceWith(createElementAST(path, info, configuration));
  } else if (isComponent(info)) {
    path.replaceWith(createComponentAST(info, importActualDOM, importShared));
  } else if (isFragment(info)) {
    path.replaceWith(
      callExpression(
        importActualDOM(createFragment),
        info.dynamicChildren
          .reduce(
            (children, [child, index]) => {
              children[index] = isExpression(child)
                ? child.value
                : isElement(child)
                ? createElementAST(path, child, configuration)
                : createComponentAST(child as ComponentInfo, importActualDOM, importShared);
              return children;
            },
            info.staticChildren.reduce((children, [child, index]) => {
              children[index] = Array.isArray(child)
                ? arrayExpression(
                    child.reduce((comments, comment) => {
                      comments.push(
                        objectExpression([
                          objectProperty(stringLiteral('type'), importShared(Comment)),
                          objectProperty(stringLiteral('value'), stringLiteral(comment)),
                        ]),
                      );
                      return comments;
                    }, []),
                  )
                : callExpression(importActualDOM(createText), [stringLiteral(child)]);
              return children;
            }, [] as any[]),
          )
          .filter(item => item),
      ),
    );
  }
};
