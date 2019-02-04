import cors from "cors";
import express from "express";
import graphql from "express-graphql";
import { redirectToHTTPS } from "express-http-to-https";
import proxy from "http-proxy-middleware";
import * as path from "path";
import process from "process";
import calendar from "./calendar";
import conferences from "./conferences";
import generateSchema from "./schema";

// FIXME: Resolve media path against project root, not module as this is brittle
const projectRoot = path.resolve(__dirname, "../../");

async function createRouter() {
  // @ts-ignore
  const router = new express.Router();
  const schema = await generateSchema();
  const mediaUrl = "/media";
  const mediaPath = path.join(projectRoot, "media");

  router.use(cors());
  router.use(redirectToHTTPS([/localhost:(\d{4})/]));

  router.all(
    "/graphql",
    (req, res, next) => {
      // Patch for app query. Once the app is updated, this can go away.
      req.body.query = patchQuery(req.body.query);

      next();
    },
    graphql(request => {
      const hostname = getHostname(request);

      return {
        graphiql: true,
        pretty: true,
        schema,
        context: {
          hostname,
          mediaPath,
          mediaUrl: `${hostname}${mediaUrl}`,
        },
      };
    })
  );

  routeMedia(router, mediaUrl, mediaPath);
  routeCalendar(router);

  return router;
}

function routeMedia(router, mediaUrl, mediaPath) {
  if (process.env.PROXY_CLOUDINARY) {
    // TODO: Use other asset path for this so it can be tested on server
    router.all(
      `${mediaUrl}/*`,
      proxy({ target: "https://res.cloudinary.com" })
    );
  } else {
    router.use(mediaUrl, express.static(mediaPath));
  }
}

function routeCalendar(router) {
  router.all("/calendar/:id", (req, res) => {
    const conference = conferences[req.params.id];

    if (conference) {
      calendar({
        filename: `calendar-${conference.id}`,
        title: conference.name,
        schedules: conference.schedules,
      })(req, res);
    } else {
      res.status(404).end("Not found");
    }
  });

  // TODO: Make a better abstraction for this
  const calendarFile = "calendar-2019.ics";
  router.all(
    `/${calendarFile}`,
    calendar({
      filename: calendarFile,
      title: "React Finland 2019",
      schedules: conferences["react-finland-2019"].schedules,
    })
  );
}

function getHostname(req) {
  if (process.env.HEROKU_HOSTNAME) {
    return process.env.HEROKU_HOSTNAME;
  } else {
    return req.protocol + "://" + req.get("host");
  }
}

// FIXME: Ideally this should traverse query tree and replace
// .. on Workshop and ... on Talk with a single query.
function patchQuery(query) {
  const q = `
  {
    conference(id: "react-finland-2019") {
      schedules {
        day
        intervals {
          begin
          end
          sessions {
            title
            description
            type
            ... on Workshop {
              speakers {
                name
                image {
                  url
                }
              }
            }
            ... on Talk {
              speakers {
                name
                image {
                  url
                }
              }
            }
            location {
              name
              city
              address
            }
          }
        }
      }
    }
  }
  `;

  if (!query) {
    return query;
  }

  if (q.replace(/(\n| )*/g, "") === query.replace(/(\n| )*/g, "")) {
    return `
    {
      conference(id: "react-finland-2019") {
        schedules {
          day
          intervals {
            begin
            end
            sessions {
              title
              description
              type
              speakers {
                name
                image {
                  url
                }
              }
              location {
                name
                city
                address
              }
            }
          }
        }
      }
    }
    `;
  }

  return query;
}

export default createRouter;
